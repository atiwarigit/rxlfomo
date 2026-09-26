import { describe, expect, it } from 'vitest';
import type { Position } from '../../types/portfolio.ts';
import { tagDrips } from '../portfolio/load.ts';
import { classifyTx, summarize, type DripStats } from './drip.ts';

const OWNER = 'Owner1111';
const WNEAR = 'wNearMint';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function tx(opts: {
  payer: string;
  pre: [string, string, number][];
  post: [string, string, number][];
  lamports?: [number, number];
}) {
  const bal = (rows: [string, string, number][]) =>
    rows.map(([mint, owner, ui]) => ({ mint, owner, uiTokenAmount: { uiAmount: ui } }));
  return {
    blockTime: Math.floor(Date.now() / 1000) - 3600,
    meta: {
      err: null,
      preBalances: [5_000_000, opts.lamports?.[0] ?? 1_000_000],
      postBalances: [4_990_000, opts.lamports?.[1] ?? 1_000_000],
      preTokenBalances: bal(opts.pre),
      postTokenBalances: bal(opts.post),
    },
    transaction: { message: { accountKeys: [{ pubkey: opts.payer }, { pubkey: OWNER }] } },
  };
}

describe('classifyTx', () => {
  it('reads a distributor batch transfer as a drip receipt', () => {
    const drip = tx({
      payer: 'Distributor643',
      pre: [[WNEAR, OWNER, 100], [WNEAR, 'Other1', 5], [WNEAR, 'Other2', 5], [WNEAR, 'Dist', 500]],
      post: [[WNEAR, OWNER, 112.7], [WNEAR, 'Other1', 6], [WNEAR, 'Other2', 6], [WNEAR, 'Dist', 485.3]],
    });
    const c = classifyTx(drip, OWNER, WNEAR);
    expect(c.kind).toBe('receipt');
    expect(c.amount).toBeCloseTo(12.7);
    expect(c.recipients).toBe(3);
  });

  it('reads a relayed Jupiter swap that spends USDC as a buy', () => {
    const buy = tx({
      payer: 'FomoRelayer',
      pre: [[WNEAR, OWNER, 100], [USDC, OWNER, 500]],
      post: [[WNEAR, OWNER, 160], [USDC, OWNER, 200]],
    });
    expect(classifyTx(buy, OWNER, WNEAR).kind).toBe('buy');
  });

  it('reads selling drip into USDC as a sell', () => {
    const sell = tx({
      payer: 'FomoRelayer',
      pre: [[WNEAR, OWNER, 166.8], [USDC, OWNER, 0]],
      post: [[WNEAR, OWNER, 100], [USDC, OWNER, 328.76]],
    });
    const c = classifyTx(sell, OWNER, WNEAR);
    expect(c.kind).toBe('sell');
    expect(c.amount).toBeCloseTo(66.8);
  });
});

describe('summarize', () => {
  it('calls repeated receipts with no buys drip, and with buys mixed', () => {
    const receipt = { kind: 'receipt' as const, amount: 10, payer: 'D', recipients: 17 };
    const buy = { kind: 'buy' as const, amount: 5, payer: 'R', recipients: 1 };
    const at = Math.floor(Date.now() / 1000) - 86_400;
    expect(summarize(WNEAR, [{ cls: receipt, at }, { cls: receipt, at }]).kind).toBe('drip');
    expect(summarize(WNEAR, [{ cls: receipt, at }, { cls: receipt, at }, { cls: buy, at }]).kind).toBe('mixed');
    expect(summarize(WNEAR, [{ cls: buy, at }]).kind).toBe('trade');
    expect(summarize(WNEAR, [{ cls: receipt, at }, { cls: receipt, at }]).windowDays).toBeCloseTo(1, 1);
  });
});

function pos(over: Partial<Position>): Position {
  return {
    id: over.symbol || 'x',
    token: over.symbol || 'X',
    symbol: 'X',
    chain: 'solana',
    sizeUsd: 100,
    amount: 100,
    entryPrice: 1,
    currentPrice: 1,
    entryMcap: 0,
    currentMcap: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 1,
    entryDate: '2026-09-26T00:00:00Z',
    source: 'onchain',
    ...over,
  };
}

describe('tagDrips', () => {
  it('marks the reward, the pairs paying it, and splits drip/day by size', async () => {
    const near = pos({ symbol: 'NEAR', mint: WNEAR, sizeUsd: 12_000, amount: 2400 });
    const nearkat = pos({ symbol: 'NEARKAT', mint: 'kat', quoteSymbol: 'wNEAR', sizeUsd: 120_000 });
    const batman = pos({ symbol: 'BATMAN', mint: 'bat', quoteSymbol: 'wNEAR', sizeUsd: 40_000 });
    const knots = pos({ symbol: 'KNOTS', mint: 'knots', quoteSymbol: 'STONK', sizeUsd: 130_000 });
    const stats: DripStats = {
      mint: WNEAR,
      kind: 'drip',
      receipts: 10,
      receivedAmount: 100,
      buys: 0,
      boughtAmount: 0,
      sells: 1,
      soldAmount: 66.8,
      windowDays: 2,
      payers: ['D'],
    };
    const seen: string[][] = [];
    await tagDrips([near, nearkat, batman, knots], 'owner', fetch, async (_o, mints) => {
      seen.push(mints);
      return new Map([[WNEAR, stats]]);
    });
    expect(seen[0]).toEqual([WNEAR]);
    expect(near.strategy).toBe('drip-reward');
    expect(near.dripReceivedUsd).toBeCloseTo(500);
    expect(near.dripPerDayUsd).toBeCloseTo(250);
    expect(near.dripFrom).toEqual(['NEARKAT', 'BATMAN']);
    expect(nearkat.strategy).toBe('drip-pair');
    expect(nearkat.dripPays).toBe('NEAR');
    expect(nearkat.dripPerDayUsd).toBeCloseTo(187.5);
    expect(batman.dripPerDayUsd).toBeCloseTo(62.5);
    expect(knots.strategy).toBe('trade');
  });
});
