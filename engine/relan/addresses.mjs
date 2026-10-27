import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { CoreError } from '../service/identity.mjs';

export function isRelanAddress(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 10 || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168 || first === 100 && second >= 64 && second <= 127;
}

export function eligibleAddresses(interfaces = networkInterfaces()) {
  const rows = Array.isArray(interfaces) ? interfaces : Object.entries(interfaces ?? {}).flatMap(([name, entries]) => (entries ?? []).map(entry => ({ name, ...entry })));
  return rows.filter(item => item.internal !== true && isRelanAddress(item.address))
    .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address, 'en'))
    .map(({ name, address, netmask }) => ({ name, address, netmask }));
}

export function parsePeerAddress(value, defaultPort = 43119, { allowLoopback = false } = {}) {
  const match = typeof value === 'string' && value.match(/^([^:]+)(?::([0-9]{1,5}))?$/);
  const address = match?.[1];
  const port = match?.[2] === undefined ? defaultPort : Number(match[2]);
  if (!match || !(isRelanAddress(address) || allowLoopback && isIP(address) === 4 && address.startsWith('127.'))
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CoreError(422, 'invalid_relan_address', 'The ReLAN peer must be a private or tailnet IPv4 address with a valid port.');
  }
  return { address, port };
}
