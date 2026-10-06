// Prints a new Solana keypair for the agent wallet. Put the secret in server env as AGENT_SIGNER; never commit it.
import { generateKeyPairSync, createPublicKey } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
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

const { privateKey } = generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
const pub = spki.subarray(-32);
console.log(`address       ${b58(pub)}`);
console.log(`AGENT_SIGNER  ${b58(Buffer.concat([seed, pub]))}`);
