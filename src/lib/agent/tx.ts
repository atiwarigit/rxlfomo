import { base58Encode, type AgentSigner } from './keys.ts';

/** The only top-level programs a signed agent transaction may call: a Jupiter swap and its setup. */
export const SWAP_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'ComputeBudget111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

function shortVec(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let size = 0;
  for (;;) {
    const b = bytes[at + size];
    value |= (b & 0x7f) << (7 * size);
    size += 1;
    if ((b & 0x80) === 0) return [value, size];
    if (size > 3) throw new Error('bad shortvec');
  }
}

export interface ParsedTx {
  signatureCount: number;
  messageOffset: number;
  requiredSigners: number;
  accountKeys: string[];
  programs: string[];
}

export function parseTransaction(bytes: Uint8Array): ParsedTx {
  const [signatureCount, sigLen] = shortVec(bytes, 0);
  const messageOffset = sigLen + signatureCount * 64;
  let at = messageOffset;
  if (bytes[at] & 0x80) {
    if ((bytes[at] & 0x7f) !== 0) throw new Error('unsupported transaction version');
    at += 1;
  }
  const requiredSigners = bytes[at];
  at += 3;
  const [keyCount, keyLen] = shortVec(bytes, at);
  at += keyLen;
  const accountKeys: string[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    accountKeys.push(base58Encode(bytes.subarray(at, at + 32)));
    at += 32;
  }
  at += 32;
  const [ixCount, ixLen] = shortVec(bytes, at);
  at += ixLen;
  const programs: string[] = [];
  for (let i = 0; i < ixCount; i += 1) {
    const programIndex = bytes[at];
    at += 1;
    const [accLen, accSize] = shortVec(bytes, at);
    at += accSize + accLen;
    const [dataLen, dataSize] = shortVec(bytes, at);
    at += dataSize + dataLen;
    const program = accountKeys[programIndex];
    if (!program) throw new Error('instruction program is not a static key');
    programs.push(program);
  }
  return { signatureCount, messageOffset, requiredSigners, accountKeys, programs };
}

/** Signs a Jupiter swap transaction only if the agent is the sole signer and every instruction is a swap program. */
export function signSwapTransaction(base64: string, signer: AgentSigner): { signed: string; signature: string } {
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  const tx = parseTransaction(bytes);
  if (tx.requiredSigners !== 1 || tx.signatureCount !== 1) throw new Error('swap must have exactly one signer');
  if (tx.accountKeys[0] !== signer.address) throw new Error('swap fee payer is not the agent wallet');
  const stray = tx.programs.find((p) => !SWAP_PROGRAMS.has(p));
  if (stray) throw new Error(`swap calls a non-swap program ${stray}`);
  if (!tx.programs.includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')) throw new Error('not a Jupiter swap');
  const sig = signer.sign(bytes.subarray(tx.messageOffset));
  const out = Uint8Array.from(bytes);
  out.set(sig, 1);
  return { signed: Buffer.from(out).toString('base64'), signature: base58Encode(sig) };
}
