import { createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync } from 'node:crypto';

const P = (1n << 255n) - 19n;
const A = 486662n;
const PUBLIC_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PRIVATE_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function field(value) { return ((value % P) + P) % P; }

function power(value, exponent) {
  let result = 1n;
  let base = field(value);
  // Both exponents used below are fixed public constants.
  for (let remaining = exponent; remaining > 0n; remaining >>= 1n) {
    if (remaining & 1n) result = field(result * base);
    base = field(base * base);
  }
  return result;
}

function lengthValue(value) {
  const encoded = [];
  let remaining = value.length;
  do {
    encoded.push((remaining & 127) | (remaining >= 128 ? 128 : 0));
    remaining = Math.floor(remaining / 128);
  } while (remaining);
  return Buffer.concat([Buffer.from(encoded), value]);
}

function concatenate(...values) { return Buffer.concat(values.map(lengthValue)); }

// draft-irtf-cfrg-cpace-21 sections 8.1, 8.2 and A.5. This is the
// CPace-specific hash/decoding, followed by RFC 9380 section 6.7.1 Elligator2.
// https://www.ietf.org/archive/id/draft-irtf-cfrg-cpace-21.html
// JavaScript BigInt has no constant-time guarantee; scalar DH stays in OpenSSL.
export function cpaceGenerator(code, session, context) {
  const password = Buffer.from(code);
  const domain = Buffer.from('CPace255');
  const padding = Buffer.alloc(Math.max(0, 128 - 1 - lengthValue(password).length - lengthValue(domain).length));
  const digest = createHash('sha512').update(concatenate(domain, password, padding, context, session)).digest().subarray(0, 32);
  const u = field(BigInt(`0x${Buffer.from(digest).reverse().toString('hex')}`) & ((1n << 255n) - 1n));
  return mapToCurve25519(u);
}

export function mapToCurve25519(value) {
  const u = field(value);
  // Z = 2 is a nonsquare; 1 + Z*u^2 cannot vanish in this field.
  const x1 = field(-A * power(1n + 2n * u * u, P - 2n));
  const gx1 = field(x1 * (x1 * x1 + A * x1 + 1n));
  const epsilon = power(gx1, (P - 1n) / 2n);
  const x = field(epsilon * x1 - (1n - epsilon) * A * ((P + 1n) / 2n));
  return Buffer.from(x.toString(16).padStart(64, '0'), 'hex').reverse();
}

export function cpaceMultiply(scalar, point) {
  if (!Buffer.isBuffer(scalar) || scalar.length !== 32 || !Buffer.isBuffer(point) || point.length !== 32) {
    throw new Error('Invalid CPace point or scalar.');
  }
  const privateKey = createPrivateKey({ key: Buffer.concat([PRIVATE_PREFIX, scalar]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey({ key: Buffer.concat([PUBLIC_PREFIX, point]), format: 'der', type: 'spki' });
  // OpenSSL refuses low-order inputs; also check the identity explicitly.
  const secret = diffieHellman({ privateKey, publicKey });
  if (secret.equals(Buffer.alloc(32))) throw new Error('Invalid CPace point.');
  return secret;
}

export function cpaceKey(secret, session, server, client, context) {
  if (!Buffer.isBuffer(secret) || secret.length !== 32 || secret.equals(Buffer.alloc(32))) throw new Error('Invalid CPace secret.');
  // The host sends the first CPace point, so it is first in transcript_ir.
  const transcript = concatenate(server, context, client, context);
  const intermediate = createHash('sha512').update(concatenate(Buffer.from('CPace255_ISK'), session, secret)).update(transcript).digest();
  return Buffer.from(hkdfSync('sha256', intermediate, Buffer.alloc(0), transcript, 32));
}
