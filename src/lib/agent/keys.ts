import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base58');
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export interface AgentSigner {
  address: string;
  publicKey: Uint8Array;
  sign: (message: Uint8Array) => Uint8Array;
}

function fromSeed(seed: Uint8Array): AgentSigner {
  const key: KeyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  const publicKey = Uint8Array.from(spki.subarray(spki.length - 32));
  return {
    address: base58Encode(publicKey),
    publicKey,
    sign: (message) => Uint8Array.from(sign(null, Buffer.from(message), key)),
  };
}

/** AGENT_SIGNER is the 64-byte Solana secret (seed + public key) as base58 or a JSON byte array. */
export function loadSigner(secret: string | undefined): AgentSigner {
  const raw = (secret || '').trim();
  if (!raw) throw new Error('AGENT_SIGNER is not set');
  const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : base58Decode(raw);
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error('AGENT_SIGNER must be a 64-byte Solana secret');
  const signer = fromSeed(bytes.subarray(0, 32));
  if (bytes.length === 64 && base58Encode(bytes.subarray(32)) !== signer.address) {
    throw new Error('AGENT_SIGNER public half does not match its seed');
  }
  return signer;
}

export function generateSecret(): { address: string; secret: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = Uint8Array.from(der.subarray(der.length - 32));
  const signer = fromSeed(seed);
  const full = new Uint8Array(64);
  full.set(seed, 0);
  full.set(signer.publicKey, 32);
  return { address: signer.address, secret: base58Encode(full) };
}
