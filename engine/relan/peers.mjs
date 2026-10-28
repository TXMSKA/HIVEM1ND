import { execFile as nodeExecFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { CoreError } from '../service/identity.mjs';
import { assertNoLinks } from '../service/paths.mjs';
import { protectBootstrapFiles, protectLocalFile, verifyLocalPermissions } from '../service/security.mjs';
import { parsePeerAddress } from './addresses.mjs';

const FORMAT = 'hivem1nd-relan-peers-v1'; // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
const writing = new Map();

function peersFile(options) {
  if (typeof options.localDirectory !== 'string' || !path.isAbsolute(options.localDirectory)) {
    throw new CoreError(422, 'invalid_path', 'ReLAN peers need the local service directory.');
  }
  return path.join(options.localDirectory, 'relan-peers.json');
}

function peerAddress(value, options) {
  if (!value || typeof value.address !== 'string' || value.port != null && !Number.isInteger(value.port)) {
    throw new CoreError(422, 'invalid_relan_address', 'The ReLAN peer address is not valid.');
  }
  return parsePeerAddress(`${value.address}:${value.port ?? 43119}`, 43119, { allowLoopback: options.allowLoopback === true });
}

function ordered(peers) {
  return peers.sort((a, b) => a.address.localeCompare(b.address) || a.port - b.port);
}

function samePeer(a, b) {
  return a.address === b.address && a.port === b.port;
}

async function readPeers(file, options) {
  await assertNoLinks(file, { root: options.store?.confineRoot });
  let handle;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 262144
      || typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new CoreError(422, 'unsafe_path', 'The ReLAN peers must be a private regular file.');
    }
    await verifyLocalPermissions(options.localDirectory, options);
    await verifyLocalPermissions(file, options);
    let peers;
    try {
      const saved = JSON.parse(await handle.readFile('utf8'));
      if (saved?.format !== FORMAT || !Array.isArray(saved.peers) || saved.peers.length > 4096) throw new Error();
      peers = saved.peers.map(peer => peerAddress(peer, options));
      if (new Set(peers.map(peer => `${peer.address}:${peer.port}`)).size !== peers.length) throw new Error();
    } catch {
      throw new CoreError(422, 'invalid_relan_peers', 'The saved ReLAN peers are not valid.');
    }
    await assertNoLinks(file, { root: options.store?.confineRoot });
    const current = await lstat(file);
    if (current.dev !== info.dev || current.ino !== info.ino) {
      throw new CoreError(409, 'relan_peers_changed', 'The ReLAN peers changed while reading.');
    }
    return ordered(peers);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

async function savePeers(file, peers, options) {
  await assertNoLinks(file, { root: options.store?.confineRoot });
  await mkdir(options.localDirectory, { recursive: true, mode: 0o700 });
  await protectLocalFile(options.localDirectory, options);
  await verifyLocalPermissions(options.localDirectory, options);
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ format: FORMAT, peers })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await protectBootstrapFiles(options.localDirectory, temporary, options);
    await readPeers(file, options);
    await assertNoLinks(temporary, { root: options.store?.confineRoot });
    await rename(temporary, file);
    await verifyLocalPermissions(file, options);
  } finally {
    await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export async function openKnownPeers(options = {}) {
  const file = peersFile(options);
  let peers = await readPeers(file, options);
  const update = async (peer, adding) => {
    const value = peerAddress(peer, options);
    const pending = (writing.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const saved = await readPeers(file, options);
      const present = saved.some(item => samePeer(item, value));
      if (present === adding) { peers = saved; return false; }
      const next = adding ? ordered([...saved, value]) : saved.filter(item => !samePeer(item, value));
      if (next.length > 4096) throw new CoreError(422, 'invalid_relan_peers', 'The ReLAN peer limit was reached.');
      await savePeers(file, next, options);
      peers = next;
      return true;
    });
    writing.set(file, pending);
    try { return await pending; } finally { if (writing.get(file) === pending) writing.delete(file); }
  };
  return {
    list() { return peers.map(peer => ({ ...peer })); },
    add(peer) { return update(peer, true); },
    remove(peer) { return update(peer, false); },
  };
}

export function parseTailscaleStatus(json) {
  try {
    const value = typeof json === 'string' || Buffer.isBuffer(json) ? JSON.parse(String(json)) : json;
    if (!value?.Peer || typeof value.Peer !== 'object' || Array.isArray(value.Peer)) return [];
    const peers = new Map();
    for (const peer of Object.values(value.Peer)) {
      if (peer?.Online !== true || !Array.isArray(peer.TailscaleIPs)) continue;
      for (const address of peer.TailscaleIPs) {
        if (typeof address !== 'string' || isIP(address) !== 4) continue;
        try {
          const parsed = parsePeerAddress(address);
          peers.set(`${parsed.address}:${parsed.port}`, parsed);
        } catch { /* Only eligible IPv4 peers are useful for ReLAN. */ }
      }
    }
    return ordered([...peers.values()]);
  } catch {
    return [];
  }
}

export async function tailscalePeers({ execFile: run = nodeExecFile } = {}) {
  return new Promise(resolve => {
    try {
      run('tailscale', ['status', '--json'], { windowsHide: true, timeout: 3000, maxBuffer: 1048576 },
        (error, stdout) => resolve(error ? [] : parseTailscaleStatus(stdout)));
    } catch {
      resolve([]);
    }
  });
}
