import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { CoreError, validateMachineName } from '../service/identity.mjs';
import { eligibleAddresses, isRelanAddress, parsePeerAddress } from './addresses.mjs';

const FORMAT = 'hivem1nd-relan-v1'; // Compatibility: persisted format and contract identifiers keep existing records and peers readable.
const FIELDS = ['epoch', 'format', 'host', 'port', 'relanId'];

export function parseDiscovery(bytes) {
  try {
    if (Buffer.byteLength(bytes) > 1024) return null;
    const value = JSON.parse(String(bytes));
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== FIELDS.join(',')) return null;
    if (value.format !== FORMAT || typeof value.relanId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value.relanId)) return null;
    validateMachineName(value.host);
    if (!Number.isSafeInteger(value.epoch) || value.epoch < 0 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return null;
    return value;
  } catch {
    return null;
  }
}

export function privateAddresses({ addresses, interfaces = networkInterfaces(), allowLoopback = false } = {}) {
  const available = eligibleAddresses(typeof interfaces === 'function' ? interfaces() : interfaces);
  const selected = addresses ?? available.map((item) => item.address);
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new CoreError(422, 'invalid_relan_address', 'ReLAN needs a private IPv4 address.');
  }
  return selected.map((address) => {
    const current = available.find((item) => item.address === address);
    if (current) return current;
    if (allowLoopback && /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address) && address.split('.').every((part) => Number(part) <= 255)) {
      return { address, netmask: '255.0.0.0', name: 'loopback' };
    }
    throw new CoreError(422, 'invalid_relan_address', 'The ReLAN address is not a current private interface.');
  });
}

export async function openDiscovery({ addresses, interfaces, allowLoopback = false, port = 43119, targets = null, broadcast = true, peers = () => [], sweepBudget = 256, onMessage = () => {}, onError = () => {} } = {}) {
  const selected = privateAddresses({ addresses, interfaces, allowLoopback });
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CoreError(422, 'invalid_relan_address', 'The discovery port is not valid.');
  if (!Number.isInteger(sweepBudget) || sweepBudget < 1 || sweepBudget > 4096) throw new CoreError(422, 'invalid_relan_address', 'The discovery sweep budget is not valid.');
  const sweeps = selected.map((item) => subnetSweep(item, sweepBudget, allowLoopback));
  const destinations = targets?.map((target) => {
    const parts = String(target.address).split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255) || !privatePeer(target.address, allowLoopback) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new CoreError(422, 'invalid_relan_address', 'The discovery destination is not valid.');
    }
    return { address: target.address, port: target.port };
  });
  const sockets = [];
  try {
    for (const address of selected) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      socket.on('message', (bytes, peer) => {
        const message = parseDiscovery(bytes);
        if (message && privatePeer(peer.address, allowLoopback)) onMessage(message, { address: peer.address, port: peer.port });
      });
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(port, address.address, () => {
          socket.removeListener('error', reject);
          resolve();
        });
      });
      if (broadcast) socket.setBroadcast(true);
      socket.on('error', onError);
      socket.unref();
    }
  } catch (error) {
    for (const socket of sockets) try { socket.close(); } catch { /* The socket did not bind. */ }
    throw error;
  }
  let closed = false;
  return {
    listeners: sockets.map((socket) => ({ address: socket.address().address, port: socket.address().port })),
    send(value) {
      if (closed) return;
      if (!parseDiscovery(Buffer.from(JSON.stringify(value)))) throw new CoreError(422, 'invalid_relan_discovery', 'The discovery announcement is not valid.');
      const bytes = Buffer.from(JSON.stringify(value));
      for (let index = 0; index < sockets.length; index += 1) {
        // Windows does not deliver broadcasts to a socket bound to one interface address.
        const local = broadcast && !selected[index].address.startsWith('100.')
          ? [{ address: broadcastAddress(selected[index]), port }, ...sweeps[index]().map((address) => ({ address, port }))] : [];
        const known = (typeof peers === 'function' ? peers() : peers).flatMap((peer) => {
          try { return [parsePeerAddress(`${peer.address}:${peer.port}`, 43119, { allowLoopback })]; } catch { return []; }
        });
        const rows = new Map([...(destinations ?? local), ...known].map((target) => [`${target.address}:${target.port}`, target]));
        for (const target of rows.values()) sockets[index].send(bytes, target.port, target.address, (error) => { if (error && !closed) onError(error); });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(sockets.map((socket) => new Promise((resolve) => socket.close(resolve))));
    },
  };
}

function broadcastAddress({ address, netmask }) {
  const parts = address.split('.').map(Number);
  const mask = String(netmask).split('.').map(Number);
  return parts.map((part, index) => (part | (~mask[index] & 255))).join('.');
}

function privatePeer(address, allowLoopback) {
  return isRelanAddress(address) || allowLoopback && /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address) && address.split('.').every((part) => Number(part) <= 255);
}

function subnetSweep({ address, netmask }, budget, allowLoopback) {
  const number = (value) => value.split('.').reduce((sum, part) => (sum * 256) + Number(part), 0) >>> 0;
  const host = number(address);
  const mask = number(netmask);
  const first = (host & mask) >>> 0;
  const last = (first | (~mask >>> 0)) >>> 0;
  const count = Math.max(0, last - first - 1);
  let cursor = Math.max(first + 1, ((host & 0xffffff00) >>> 0) + 1);
  return () => {
    const result = [];
    let scanned = 0;
    while (result.length < budget && scanned < count) {
      if (cursor >= last) cursor = first + 1;
      const candidate = cursor;
      cursor += 1;
      scanned += 1;
      if (candidate === host) continue;
      const value = [24, 16, 8, 0].map((shift) => (candidate >>> shift) & 255).join('.');
      if (privatePeer(value, allowLoopback)) result.push(value);
    }
    return result;
  };
}
