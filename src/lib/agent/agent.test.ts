import { describe, expect, it, vi } from 'vitest';
import type { TapeRow } from '../../types/plays.ts';
import { agentSize, buyRejections, confirmIntent, stageIntent, type AgentDeps } from './agent.ts';
import { base58Decode, base58Encode, generateSecret, loadSigner } from './keys.ts';
import type { AgentStore, IntentRow, NewIntent, PositionRow } from './store.ts';
import { parseTransaction, signSwapTransaction } from './tx.ts';
import { verify, createPublicKey } from 'node:crypto';

const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SYSTEM = '11111111111111111111111111111111';

function row(over: Partial<TapeRow> = {}): TapeRow {
  return {
    chain: 'solana',
    mint: 'Mint1111111111111111111111111111111111111pump',
    symbol: 'RUN',
    name: 'Runner',
    dexId: 'pumpswap',
    quoteSymbol: 'SOL',
    liquidityUsd: 60_000,
    volume1hUsd: 90_000,
    marketCapUsd: 400_000,
    fdvUsd: 400_000,
    launchedAt: new Date().toISOString(),
    change5mPct: 2,
    change1hPct: 20,
    change6hPct: 30,
    buys1h: 300,
    sells1h: 150,
    ageHours: 3,
    pairUrl: 'https://dexscreener.com/solana/x',
    sources: ['dex-boost'],
    ...over,
  };
}

const goodBook = { equity: 10_000, cashUsd: 5_000, cashPct: 50, drawdownPct: -2, top3Pct: 30, topNamePct: 10 };

function shortVec(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if (!n) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

function fakeTx(payer: string, programs: string[], signers = 1): string {
  const keys = [payer, ...programs].map((k) => Array.from(base58Decode(k).length === 32 ? base58Decode(k) : new Uint8Array(32)));
  const msg = [
    0x80,
    signers,
    0,
    programs.length,
    ...shortVec(keys.length),
    ...keys.flat(),
    ...new Array(32).fill(7),
    ...shortVec(programs.length),
    ...programs.flatMap((_, i) => [i + 1, ...shortVec(1), 0, ...shortVec(2), 9, 9]),
    ...shortVec(0),
  ];
  return Buffer.from([...shortVec(signers), ...new Array(64 * signers).fill(0), ...msg]).toString('base64');
}

function memoryStore(positions: PositionRow[] = []): AgentStore & { rows: IntentRow[] } {
  const rows: IntentRow[] = [];
  const toRow = (n: NewIntent): IntentRow => ({
    id: n.id,
    handle: n.handle,
    mint: n.mint,
    symbol: n.symbol,
    side: n.side,
    status: n.status,
    reason: n.reason,
    rejectReason: n.rejectReason,
    sizeUsd: n.sizeUsd,
    quoteOut: n.quoteOut,
    priceImpactPct: n.priceImpactPct,
    playSnapshot: n.playSnapshot,
    expiresAt: n.expiresInSec ? new Date(Date.now() + n.expiresInSec * 1000).toISOString() : null,
    confirmedAt: null,
    signature: null,
    error: null,
    createdAt: new Date().toISOString(),
  });
  return {
    rows,
    bootWallet: async (address, withdrawAddress) => ({
      id: 'agent',
      address,
      chain: 'solana',
      capUsd: 500,
      withdrawAddress,
      createdAt: new Date().toISOString(),
    }),
    positions: async () => positions,
    position: async (mint) => positions.find((p) => p.mint === mint) ?? null,
    insertIntent: async (n) => {
      const r = toRow(n);
      rows.push(r);
      return r;
    },
    intent: async (id) => rows.find((r) => r.id === id) ?? null,
    recentIntents: async () => rows.slice(-20).reverse(),
    expirePending: async () => {
      for (const r of rows) if (r.status === 'pending' && r.expiresAt && Date.parse(r.expiresAt) <= Date.now()) r.status = 'expired';
    },
    claimPending: async (id) => {
      const r = rows.find((x) => x.id === id && x.status === 'pending' && Date.parse(x.expiresAt!) > Date.now());
      if (!r) return null;
      r.status = 'failed';
      return r;
    },
    finishIntent: async (id, patch) => {
      const r = rows.find((x) => x.id === id)!;
      r.status = patch.status;
      r.signature = patch.signature ?? r.signature;
      r.error = patch.error ?? null;
    },
    upsertBuy: async () => {},
    closePosition: async () => {},
  };
}

function deps(over: Partial<AgentDeps> & { rows?: TapeRow[] } = {}): AgentDeps {
  const signer = loadSigner(generateSecret().secret);
  return {
    store: memoryStore(),
    signer,
    rpcUrl: 'http://rpc.test',
    env: {},
    tape: async () => ({ rows: over.rows ?? [row()], fetchedAt: Date.now() }),
    fetchFn: vi.fn(async () => {
      throw new Error('network should not be called');
    }) as unknown as typeof fetch,
    ...over,
  };
}

describe('agent keys', () => {
  it('round-trips base58 and derives a 32-byte address from AGENT_SIGNER', () => {
    const { address, secret } = generateSecret();
    expect(base58Decode(secret)).toHaveLength(64);
    const signer = loadSigner(secret);
    expect(signer.address).toBe(address);
    expect(base58Encode(base58Decode(address))).toBe(address);
    expect(loadSigner(JSON.stringify(Array.from(base58Decode(secret)))).address).toBe(address);
  });
});

describe('swap signing guard', () => {
  it('signs a Jupiter-only transaction in signature slot 0', () => {
    const signer = loadSigner(generateSecret().secret);
    const tx = fakeTx(signer.address, ['ComputeBudget111111111111111111111111111111', JUP]);
    const parsed = parseTransaction(Buffer.from(tx, 'base64'));
    expect(parsed.programs).toEqual(['ComputeBudget111111111111111111111111111111', JUP]);
    const { signed, signature } = signSwapTransaction(tx, signer);
    const bytes = Buffer.from(signed, 'base64');
    const sig = bytes.subarray(1, 65);
    expect(base58Encode(sig)).toBe(signature);
    const pub = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(signer.publicKey)]),
      format: 'der',
      type: 'spki',
    });
    expect(verify(null, bytes.subarray(parsed.messageOffset), pub, sig)).toBe(true);
  });

  it('refuses a transfer, another fee payer, or a second signer', () => {
    const signer = loadSigner(generateSecret().secret);
    expect(() => signSwapTransaction(fakeTx(signer.address, [JUP, SYSTEM]), signer)).toThrow(/non-swap program/);
    expect(() => signSwapTransaction(fakeTx(generateSecret().address, [JUP]), signer)).toThrow(/fee payer/);
    expect(() => signSwapTransaction(fakeTx(signer.address, [JUP], 2), signer)).toThrow(/one signer/);
  });
});

describe('intent rules', () => {
  it('rejects CHASE, stale, off-tape, book veto, thin liquidity and a held mint', () => {
    const base = { handle: 'SoftMereElk', mint: row().mint, book: goodBook, held: null };
    expect(buyRejections({ ...base, row: row() })).toEqual([]);
    expect(buyRejections({ ...base, row: undefined })).toEqual(['mint is not on the current tape']);
    expect(buyRejections({ ...base, row: row({ change1hPct: 120 }) })[0]).toMatch(/^CHASE: 1h \+120%/);
    expect(buyRejections({ ...base, row: row({ volume1hUsd: 600_000 }) })[0]).toMatch(/10\.0x liquidity is past 8x/);
    expect(buyRejections({ ...base, row: row({ ageHours: 60 }) })).toEqual(['launched 60h ago, past 48h']);
    expect(buyRejections({ ...base, row: row({ liquidityUsd: 9_000, volume1hUsd: 20_000 }) })).toEqual([
      'liquidity $9,000 under the $15,000 watch floor',
    ]);
    expect(
      buyRejections({ ...base, row: row(), book: { ...goodBook, cashPct: 1, topNamePct: 34 } }).join('; '),
    ).toBe('book veto: cash 1% under the 20% floor; book veto: top name 34% over the 15% cap');
    expect(buyRejections({ ...base, row: row(), book: null })).toEqual(['book not loaded on the page']);
    const held = { mint: row().mint, symbol: 'RUN', qty: '1', costUsd: 50, openedAt: '', updatedAt: '' };
    expect(buyRejections({ ...base, row: row(), held })).toEqual(['agent already holds RUN']);
  });

  it('sizes at min(15% equity, cap room, play cap) rounded down to $10', () => {
    expect(agentSize({ equityUsd: 500, capUsd: 500, deployedUsd: 0, playCapUsd: 1_000 }).sizeUsd).toBe(70);
    expect(agentSize({ equityUsd: 5_000, capUsd: 500, deployedUsd: 440, playCapUsd: 1_000 }).sizeUsd).toBe(60);
    expect(agentSize({ equityUsd: 5_000, capUsd: 500, deployedUsd: 0, playCapUsd: 38 }).sizeUsd).toBe(30);
    expect(agentSize({ equityUsd: 100, capUsd: 500, deployedUsd: 0, playCapUsd: 1_000 }).sizeUsd).toBe(10);
  });

  it('stages a CHASE card as rejected without touching Jupiter or the RPC', async () => {
    const d = deps({ rows: [row({ change1hPct: 95 })] });
    const out = await stageIntent(d, { handle: 'SoftMereElk', mint: row().mint, side: 'buy', book: goodBook });
    expect(out.status).toBe('rejected');
    expect(out.rejectReason).toMatch(/^CHASE/);
    expect(out.quoteOut).toBeNull();
    expect(d.fetchFn).not.toHaveBeenCalled();
  });

  it('ignores a client size and refuses handles outside scope', async () => {
    const d = deps({ rows: [row({ ageHours: 50 })] });
    const body = { handle: 'BusyMereDog', mint: row().mint, side: 'buy', book: goodBook, sizeUsd: 400 } as never;
    const out = await stageIntent(d, body);
    expect(out.sizeUsd).toBeNull();
    await expect(stageIntent(d, { handle: 'someone', mint: 'x', side: 'buy' })).rejects.toThrow(/SoftMereElk or BusyMereDog/);
  });
});

describe('confirm', () => {
  it('refuses an intent that is not pending', async () => {
    const d = deps();
    const out = await stageIntent(d, { handle: 'SoftMereElk', mint: 'nope', side: 'buy', book: goodBook });
    await expect(confirmIntent(d, out.id)).rejects.toThrow(/intent is rejected/);
    await expect(confirmIntent(d, 'int_missing')).rejects.toThrow(/no such intent/);
  });

  it('retries once, never widens slippage, and stores the error', async () => {
    const store = memoryStore();
    const d = deps({ store });
    const pending = await store.insertIntent({
      id: 'int_1',
      handle: 'SoftMereElk',
      mint: row().mint,
      symbol: 'RUN',
      side: 'buy',
      status: 'pending',
      reason: null,
      rejectReason: null,
      sizeUsd: 50,
      quoteOut: '1',
      priceImpactPct: 0.4,
      playSnapshot: { quote: { inputMint: 'USDC', outputMint: row().mint, amount: '50000000', slippageBps: 150 } },
      expiresInSec: 90,
    });
    const urls: string[] = [];
    d.fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/quote')) return new Response(JSON.stringify({ inAmount: '50000000', outAmount: '9', priceImpactPct: '0.002', slippageBps: 150 }));
      return new Response(JSON.stringify({ error: 'route gone' }), { status: 400 });
    }) as unknown as typeof fetch;
    const out = await confirmIntent(d, pending.id);
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/attempt 1: .*route gone \| attempt 2: .*route gone/);
    expect(urls.filter((u) => u.includes('/quote'))).toHaveLength(2);
    expect(urls.filter((u) => u.includes('/quote')).every((u) => u.includes('slippageBps=150'))).toBe(true);
  });
});
