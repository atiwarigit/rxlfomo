import { describe, expect, it } from 'vitest';
import type { PortfolioSnapshot, Position } from '../../types/portfolio.ts';
import type { TapeRow } from '../../types/plays.ts';
import { compactPlays } from '../ai/bookContext.ts';
import { chatPrompt } from '../ai/runChat.ts';
import {
  applyBook,
  bookVetoes,
  buildRunners,
  buildPlays,
  runnerLabel,
  runnerScore,
  scannerLaunchpad,
  vetoSentence,
} from './rules.ts';
import { pickPairBatch, rowFromDexPair, rowFromGeckoPool } from './tape.ts';

function pos(over: Partial<Position>): Position {
  return {
    id: over.symbol || 'x',
    token: over.symbol || 'x',
    symbol: 'X',
    chain: 'solana',
    sizeUsd: 500,
    entryPrice: 1,
    currentPrice: 1,
    entryMcap: 0,
    currentMcap: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 10,
    entryDate: '2026-10-01T00:00:00Z',
    source: 'onchain',
    ...over,
  };
}

function book(over: { equity?: number; cash?: number; drawdown?: number } = {}): PortfolioSnapshot {
  const equity = over.equity ?? 10_000;
  const cash = over.cash ?? 4_000;
  return {
    handle: 'BusyMereDog',
    wallets: {},
    source: { fomo: false, onchain: true, fetchedAt: '2026-10-04T00:00:00Z', warnings: [] },
    summary: {
      totalEquity: equity,
      cashUsd: cash,
      openPositionsValue: equity - cash,
      realizedPnlAllTime: null,
      unrealizedPnl: 0,
      peakEquity: equity,
      currentDrawdownPct: over.drawdown ?? -1,
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      totalTrades: 0,
      closedTradesCaptured: 0,
      followers: 0,
    },
    influence: { followers: 0, following: null },
    pnlWindows: { h24: null, d7: null, d30: null, all: null },
    openPositions: [
      pos({ symbol: 'HELD', mint: 'HeldMint1pump', launchpad: 'Pump.fun', narratives: ['Animals'], unrealizedPnl: 900 }),
      pos({ symbol: 'STK', mint: 'Stk1', launchpad: 'Stonk.fun', narratives: ['Stonks'], unrealizedPnl: 400 }),
    ],
    closedTrades: [
      {
        id: 'c1',
        token: 'w',
        symbol: 'WIN',
        chain: 'solana',
        side: 'long',
        sizeUsd: 300,
        entryPrice: 1,
        exitPrice: 2,
        realizedPnl: 300,
        realizedPnlPct: 100,
        holdTimeHours: 5,
        entryDate: '2026-09-30T00:00:00Z',
        exitDate: '2026-10-01T00:00:00Z',
        narratives: ['Animals'],
      },
    ],
    equityCurve: [],
    alerts: [],
  };
}

function tape(over: Partial<TapeRow>): TapeRow {
  return {
    chain: 'solana',
    mint: 'NewMint1pump',
    symbol: 'NEWDOG',
    name: 'New Dog',
    dexId: 'pumpswap',
    quoteSymbol: 'SOL',
    liquidityUsd: 20_000,
    volume1hUsd: 9_000,
    marketCapUsd: 30_000,
    fdvUsd: 30_000,
    launchedAt: '2026-10-04T00:00:00Z',
    change5mPct: 3,
    change1hPct: 22,
    change6hPct: 40,
    buys1h: 70,
    sells1h: 30,
    ageHours: 0.5,
    pairUrl: 'https://dexscreener.com/solana/x',
    sources: ['dex-boost'],
    ...over,
  };
}

const SMALL = { minLiq: 3_000, sizeFloorLiq: 8_000 };

describe('scannerLaunchpad', () => {
  it('maps the spec launchpads and leaves the rest unknown', () => {
    expect(scannerLaunchpad('pump-fun', 'abc')).toBe('Pump.fun');
    expect(scannerLaunchpad('raydium', 'Abcpump')).toBe('Pump.fun');
    expect(scannerLaunchpad('stonkfun', 'a')).toBe('Stonk.fun');
    expect(scannerLaunchpad('pons-v2-dex', '0xab')).toBe('Pons');
    expect(scannerLaunchpad('bankr-robinhood', '0xab')).toBe('Bankr');
    expect(scannerLaunchpad('orca', 'a')).toBe('Direct / DEX');
    expect(scannerLaunchpad('uniswap', '0xab')).toBeUndefined();
  });
});

describe('book vetoes', () => {
  it('reads as one header sentence', () => {
    expect(bookVetoes({ equity: 100, cashPct: 30, drawdownPct: -2, top3Pct: 40 })).toEqual([]);
    const v = bookVetoes({ equity: 100, cashPct: 1, drawdownPct: -47, top3Pct: 30 });
    expect(vetoSentence(v)).toBe(
      'Size $0 — cash 1% under the 20% floor, drawdown −47% past the −8% cut. These are watches, not entries.',
    );
    expect(bookVetoes({ equity: 100, cashPct: 30, drawdownPct: 0, top3Pct: 63 })).toEqual([
      'top 3 names 63% over the 45% cap',
    ]);
  });
});

describe('runnerScore', () => {
  it('scores freshness, early move, buyers, exit liquidity and wash per the spec', () => {
    const base = { liquidityUsd: 20_000, volume1hUsd: 9_000, floors: SMALL };
    expect(runnerScore({ ...base, ageHours: 0.5, change1hPct: 22, buys1h: 70, sells1h: 30 })).toBe(100);
    expect(runnerScore({ ...base, ageHours: 30, change1hPct: 98, buys1h: 30, sells1h: 70 })).toBe(4 + 4 + 0 + 20 + 10);
    expect(runnerScore({ ...base, ageHours: 4, change1hPct: -5, buys1h: 50, sells1h: 50, volume1hUsd: 500_000 })).toBe(
      22 + 0 + 10 + 20 + 0,
    );
    expect(runnerLabel(82)).toBe('early');
    expect(runnerLabel(61)).toBe('building');
    expect(runnerLabel(34)).toBe('chase');
    expect(runnerLabel(29)).toBeNull();
  });
});

describe('buildPlays', () => {
  it('labels a washed pool CHASE capped at 49 even when it is fresh (HUMAN: $447k vol on $29k liq)', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [
        tape({ mint: 'Hum1pump', symbol: 'HUMAN', liquidityUsd: 29_000, volume1hUsd: 447_000, ageHours: 0.7 }),
        tape({ mint: 'Pop1pump', symbol: 'POP', change1hPct: 120 }),
      ],
    });
    expect(plays.find((p) => p.symbol === 'HUMAN')).toMatchObject({ runnerLabel: 'chase', runnerScore: 49 });
    expect(plays.find((p) => p.symbol === 'POP')).toMatchObject({ runnerLabel: 'chase' });
    expect(plays.every((p) => p.runnerScore <= 49)).toBe(true);
  });

  it('drops names older than 48h, so a 53-day +98% trend is gone', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [tape({ mint: 'Old1pump', symbol: 'OLD', ageHours: 53 * 24, change1hPct: 98 })],
    });
    expect(plays).toEqual([]);
  });

  it('sorts a newer pool above an older Pump.fun name regardless of book fit', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [
        tape({ mint: 'Older1pump', symbol: 'OLDCAT', name: 'Old Cat', ageHours: 30, change1hPct: 12 }),
        tape({ mint: 'Fresh1', symbol: 'FRESH', name: 'Fresh', dexId: 'uniswap', ageHours: 0.4 }),
      ],
    });
    expect(plays.map((p) => p.symbol)).toEqual(['FRESH', 'OLDCAT']);
    expect(plays[0].runnerLabel).toBe('early');
    expect(plays[0].bookEdge).toBe('New to this book');
    expect(plays[1].bookEdge).toBe('Fits animals');
  });

  it('dedupes by mint and by symbol, keeping the higher runner score', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [
        tape({ mint: 'Hig1pump', symbol: 'HIGGS', ageHours: 20 }),
        tape({ mint: 'Hig1pump', symbol: 'HIGGS', ageHours: 20 }),
        tape({ mint: 'Hig2pump', symbol: 'HIGGS', ageHours: 1 }),
      ],
    });
    expect(plays).toHaveLength(1);
    expect(plays[0].mint).toBe('Hig2pump');
  });

  it('counts only realized wins or drips as book fit, never open P&L', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [tape({ mint: 'S1', dexId: 'stonkfun', symbol: 'TSLAX', name: 'tsla stonk' })],
    });
    expect(plays[0].bookFit).toBe('new');
    expect(plays[0].decision).toBe('watch');
    expect(plays[0].bookEdge).not.toMatch(/\$/);
  });

  it('sizes a fitting runner with liquidity over the floor, capped by the name and cash rules', () => {
    const { book: b, plays } = buildPlays({ handle: 'BusyMereDog', book: book(), tape: [tape({})] });
    expect(b.vetoes).toEqual([]);
    expect(plays[0]).toMatchObject({ decision: 'size', sizeCapUsd: 1_500, bookFit: 'fits' });
    expect(plays[0]).toMatchObject({ marketCapUsd: 30_000, change5mPct: 3, buys1h: 70, runnerScore: 100 });
  });

  it('skips held mints, dropped majors and thin liquidity; uses SoftMereElk floors', () => {
    const busy = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [
        tape({ mint: 'HeldMint1pump' }),
        tape({ mint: 'sol', symbol: 'USDC' }),
        tape({ mint: 'Thin1pump', liquidityUsd: 2_000 }),
        tape({ mint: 'Eth1', chain: 'ethereum' }),
      ],
    });
    expect(busy.plays).toEqual([]);
    const soft = buildPlays({
      handle: 'SoftMereElk',
      book: book({ equity: 300_000, cash: 90_000 }),
      tape: [tape({ liquidityUsd: 10_000 }), tape({ mint: 'Mid1pump', symbol: 'MID', liquidityUsd: 20_000 })],
    });
    expect(soft.book.sizeFloorLiq).toBe(40_000);
    expect(soft.plays.map((p) => p.mint)).toEqual(['Mid1pump']);
    expect(soft.plays[0].decision).toBe('watch');
  });

  it('turns every card into a $0 watch when the book has 0% cash and a double-digit drawdown', () => {
    const { book: b, plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book({ cash: 0, drawdown: -14 }),
      tape: [tape({}), tape({ mint: 'Two1pump', symbol: 'TWO', liquidityUsd: 50_000 })],
    });
    expect(b.vetoes).toHaveLength(2);
    expect(plays).toHaveLength(2);
    for (const p of plays) expect(p).toMatchObject({ decision: 'watch', sizeCapUsd: 0 });

    const text = compactPlays({ book: null, plays, books: [b], tapeCount: 2 });
    expect(text.match(/cash 0% under the 20% floor/g)).toHaveLength(1);
    const prompt = chatPrompt([{ role: 'user', content: 'Why is nothing a size?' }], {
      book: book({ cash: 0, drawdown: -14 }),
      plays,
      books: [b],
    });
    expect(prompt).toContain(`1. ${plays[0].symbol} EARLY`);
    expect(prompt).toContain('drawdown −14% past the −8% cut');
  });
});

describe('live board', () => {
  it('builds without a book: newest pool first, capped at 12, arrived vs the previous board', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      tape({ mint: `M${i}pump`, symbol: `T${i}`, ageHours: 0.1 + i }),
    );
    const first = buildRunners({ handle: 'BusyMereDog', tape: rows });
    expect(first).toHaveLength(12);
    expect(first[0].symbol).toBe('T0');
    expect(first.every((p) => !p.arrived && p.decision === 'watch')).toBe(true);
    const next = buildRunners({
      handle: 'BusyMereDog',
      tape: [tape({ mint: 'Brand1pump', symbol: 'BRAND', ageHours: 0.05 }), ...rows],
      previous: new Set(first.map((p) => p.mint)),
    });
    expect(next[0]).toMatchObject({ symbol: 'BRAND', arrived: true });
    expect(next.filter((p) => p.arrived).map((p) => p.symbol)).toEqual(['BRAND']);
  });

  it('applies the on-screen book on the page: held mints drop, vetoes force watch at $0', () => {
    const runners = buildRunners({
      handle: 'BusyMereDog',
      tape: [tape({ mint: 'HeldMint1pump', symbol: 'HELD' }), tape({})],
    });
    expect(runners).toHaveLength(2);
    const ok = applyBook('BusyMereDog', book(), runners);
    expect(ok.plays.map((p) => p.symbol)).toEqual(['NEWDOG']);
    expect(ok.plays[0]).toMatchObject({ decision: 'size', bookEdge: 'Fits animals' });
    const vetoed = applyBook('BusyMereDog', book({ cash: 0, drawdown: -14 }), runners);
    expect(vetoed.plays[0]).toMatchObject({ decision: 'watch', sizeCapUsd: 0 });
    const noBook = applyBook('BusyMereDog', null, runners);
    expect(noBook.book.vetoes).toEqual(['book not loaded yet']);
    expect(noBook.plays.every((p) => p.decision === 'watch')).toBe(true);
  });

  it('refreshes new mints first, then the stalest, at most 30 per tick', () => {
    const now = 100_000;
    const filled = new Map<string, { at: number }>([
      ['a', { at: now - 1_000 }],
      ['b', { at: now - 30_000 }],
      ['c', { at: now - 13_000 }],
    ]);
    expect(pickPairBatch(['a', 'b', 'c', 'd'], filled, now)).toEqual(['d', 'b', 'c']);
    const many = Array.from({ length: 50 }, (_, i) => `k${i}`);
    expect(pickPairBatch(many, new Map(), now)).toHaveLength(30);
  });
});

describe('tape rows', () => {
  it('reads mcap, fdv, launch time, 5m/1h/6h and 1h txns from the Dex pair', () => {
    const dex = rowFromDexPair(
      {
        chainId: 'solana',
        dexId: 'pumpswap',
        url: 'u',
        baseToken: { address: 'M1pump', symbol: 'MIA', name: 'Mia' },
        quoteToken: { symbol: 'SOL' },
        liquidity: { usd: 12_000 },
        volume: { h1: 500 },
        priceChange: { m5: -2, h1: 22.5, h6: 71 },
        txns: { h1: { buys: 84, sells: 40 } },
        marketCap: 30_000,
        fdv: 90_000,
        pairCreatedAt: 3_600_000,
        info: {
          websites: [{ url: 'https://mia.fun' }],
          socials: [
            { type: 'twitter', url: 'https://x.com/mia' },
            { type: 'telegram', url: 'https://t.me/mia' },
          ],
        },
      },
      ['dex-boost'],
      7_200_000,
    );
    expect(dex).toMatchObject({
      mint: 'M1pump',
      liquidityUsd: 12_000,
      marketCapUsd: 30_000,
      fdvUsd: 90_000,
      launchedAt: new Date(3_600_000).toISOString(),
      change5mPct: -2,
      change1hPct: 22.5,
      change6hPct: 71,
      buys1h: 84,
      sells1h: 40,
      ageHours: 1,
      website: 'https://mia.fun',
      twitter: 'https://x.com/mia',
      telegram: 'https://t.me/mia',
    });
    const noCap = rowFromDexPair({ chainId: 'solana', baseToken: { address: 'Z' }, fdv: 5_000 }, []);
    expect(noCap?.marketCapUsd).toBeNull();
    expect(noCap?.fdvUsd).toBe(5_000);

    const gecko = rowFromGeckoPool(
      {
        attributes: {
          address: 'Pool1',
          name: 'HIGGS / SOL',
          reserve_in_usd: '222542.2',
          pool_created_at: '1970-01-01T00:00:00Z',
          price_change_percentage: { h1: '-32.5' },
          volume_usd: { h1: '1681188.4' },
        },
        relationships: {
          base_token: { data: { id: 'solana_Hig1pump' } },
          dex: { data: { id: 'pumpswap' } },
        },
      },
      'gecko-trending',
      7_200_000,
    );
    expect(gecko).toMatchObject({ mint: 'Hig1pump', symbol: 'HIGGS', quoteSymbol: 'SOL', ageHours: 2 });
  });
});
