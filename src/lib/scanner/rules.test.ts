import { describe, expect, it } from 'vitest';
import type { PortfolioSnapshot, Position } from '../../types/portfolio.ts';
import type { TapeRow } from '../../types/plays.ts';
import { compactPlays } from '../ai/bookContext.ts';
import { chatPrompt } from '../ai/runChat.ts';
import { applyBookVetoes, bookVetoes, buildPlays, scannerLaunchpad } from './rules.ts';
import { rowFromDexPair, rowFromGeckoPool } from './tape.ts';

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
      pos({ symbol: 'HELD', mint: 'HeldMint1pump', launchpad: 'Pump.fun', narratives: ['Animals'] }),
      pos({ symbol: 'STK', mint: 'Stk1', launchpad: 'Stonk.fun', narratives: ['Stonks'] }),
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
        launchpad: 'Pump.fun',
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
    change1hPct: 12,
    ageHours: 3,
    pairUrl: 'https://dexscreener.com/solana/x',
    sources: ['dex-boost'],
    ...over,
  };
}

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

describe('bookVetoes', () => {
  it('fires on cash under 20% and drawdown past -8%', () => {
    expect(bookVetoes({ equity: 100, cashPct: 30, drawdownPct: -2 })).toEqual([]);
    const v = bookVetoes({ equity: 100, cashPct: 0, drawdownPct: -12 });
    expect(v).toHaveLength(2);
    expect(v[0]).toContain('20% floor');
    expect(v[1]).toContain('-8% cut');
  });
});

describe('buildPlays', () => {
  it('sizes a paid-launchpad play with liquidity over the floor, capped by name and cash rules', () => {
    const { book: b, plays } = buildPlays({ handle: 'BusyMereDog', book: book(), tape: [tape({})] });
    expect(b.vetoes).toEqual([]);
    expect(b.sizeFloorLiq).toBe(8_000);
    expect(plays).toHaveLength(1);
    expect(plays[0].decision).toBe('size');
    expect(plays[0].sizeCapUsd).toBe(1_500);
    expect(plays[0].bookEdge).toContain('Pump.fun');
  });

  it('skips held mints, dropped majors, no overlap, unknown pads, and thin liquidity', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [
        tape({ mint: 'HeldMint1pump' }),
        tape({ mint: 'sol', symbol: 'USDC' }),
        tape({ mint: 'Plain1', dexId: 'uniswap', symbol: 'ZZZ', name: 'Zzz' }),
        tape({ mint: 'Thin1pump', liquidityUsd: 2_000 }),
        tape({ mint: 'Base1', chain: 'ethereum' }),
      ],
    });
    expect(plays).toEqual([]);
  });

  it('uses the larger floors for SoftMereElk', () => {
    const { book: b, plays } = buildPlays({
      handle: 'SoftMereElk',
      book: book({ equity: 300_000, cash: 90_000 }),
      tape: [tape({ liquidityUsd: 10_000 }), tape({ mint: 'Mid1pump', liquidityUsd: 20_000 })],
    });
    expect(b.sizeFloorLiq).toBe(40_000);
    expect(plays.map((p) => p.mint)).toEqual(['Mid1pump']);
    expect(plays[0].decision).toBe('watch');
    expect(plays[0].vetoes[0]).toContain('size floor');
  });

  it('turns every card into a $0 watch when the book has 0% cash and a double-digit drawdown', () => {
    const { book: b, plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book({ cash: 0, drawdown: -14 }),
      tape: [tape({}), tape({ mint: 'Two1pump', liquidityUsd: 50_000 })],
    });
    expect(b.vetoes.length).toBe(2);
    expect(plays.length).toBe(2);
    for (const p of plays) {
      expect(p.decision).toBe('watch');
      expect(p.sizeCapUsd).toBe(0);
      expect(p.vetoes[0]).toContain('Cash 0%');
    }
    const text = compactPlays({ book: null, plays, books: [b], tapeCount: 2 });
    expect(text).toContain('[watch]');
    expect(text).toContain('Cash 0% is under the 20% floor');
    const prompt = chatPrompt([{ role: 'user', content: 'Why is nothing a size?' }], {
      book: book({ cash: 0, drawdown: -14 }),
      plays,
      books: [b],
    });
    expect(prompt).toContain('LIVE BOOK');
    expect(prompt).toContain(`SCANNER`);
    expect(prompt).toContain(`1. ${plays[0].symbol} [watch]`);
    expect(prompt).toContain('Drawdown -14.0% is past the -8% cut');
  });

  it('marks an unpaid overlap as watch', () => {
    const { plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book(),
      tape: [tape({ mint: 'S1', dexId: 'stonkfun', symbol: 'TSLAX', name: 'tsla stonk' })],
    });
    expect(plays[0].decision).toBe('watch');
    expect(plays[0].vetoes.join(' ')).toContain('has not paid');
  });
});

describe('applyBookVetoes', () => {
  it('forces watch with cap 0 when the on-screen book vetoes', () => {
    const { plays } = buildPlays({ handle: 'BusyMereDog', book: book(), tape: [tape({})] });
    const out = applyBookVetoes(plays, ['Drawdown -12.0% is past the -8% cut — size down']);
    expect(out[0]).toMatchObject({ decision: 'watch', sizeCapUsd: 0, lastCall: 'WAIT_BOOK' });
  });

  it('replaces the route copy of the book vetoes instead of listing both', () => {
    const { book: b, plays } = buildPlays({
      handle: 'BusyMereDog',
      book: book({ cash: 0, drawdown: -14 }),
      tape: [tape({})],
    });
    const onScreen = ['Cash 1% is under the 20% floor'];
    const out = applyBookVetoes(plays, onScreen, b.vetoes);
    expect(out[0].vetoes).toEqual(onScreen);
  });
});

describe('tape rows', () => {
  it('parses Dex pairs and Gecko pools', () => {
    const dex = rowFromDexPair(
      {
        chainId: 'solana',
        dexId: 'pumpswap',
        url: 'u',
        baseToken: { address: 'M1pump', symbol: 'MIA', name: 'Mia' },
        quoteToken: { symbol: 'SOL' },
        liquidity: { usd: 12_000 },
        volume: { h1: 500 },
        priceChange: { h1: 22.5 },
        pairCreatedAt: 3_600_000,
      },
      ['dex-boost'],
      7_200_000,
    );
    expect(dex).toMatchObject({ mint: 'M1pump', liquidityUsd: 12_000, change1hPct: 22.5, ageHours: 1 });
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
