import { describe, expect, it } from 'vitest';
import type { ClosedTrade, PortfolioSnapshot, Position } from '../../types/portfolio.ts';
import { closedFromRelaySwaps } from '../portfolio/relayPositions.ts';
import { launchpadRotation, narrativeRotation, rotationCall } from './rotation.ts';

function pos(over: Partial<Position>): Position {
  return {
    id: over.symbol || 'x',
    token: over.symbol || 'X',
    symbol: 'X',
    chain: 'robinhood',
    sizeUsd: 100,
    entryPrice: 1,
    currentPrice: 1,
    entryMcap: 0,
    currentMcap: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 1,
    entryDate: '2026-09-26T00:00:00Z',
    source: 'fomo',
    hasCostBasis: true,
    ...over,
  };
}

function close(over: Partial<ClosedTrade>): ClosedTrade {
  return {
    id: over.symbol || 'c',
    token: over.symbol || 'C',
    symbol: 'C',
    chain: 'robinhood',
    side: 'long',
    sizeUsd: 50,
    entryPrice: 1,
    exitPrice: 1,
    realizedPnl: 0,
    realizedPnlPct: 0,
    holdTimeHours: 1,
    entryDate: '2026-09-25T00:00:00Z',
    exitDate: '2026-09-26T00:00:00Z',
    ...over,
  };
}

function snap(open: Position[], closed: ClosedTrade[]): PortfolioSnapshot {
  return {
    wallets: {},
    source: { fomo: false, onchain: true, fetchedAt: '', warnings: [] },
    summary: {
      totalEquity: 400,
      cashUsd: 0,
      openPositionsValue: 400,
      realizedPnlAllTime: null,
      realizedPnl7d: null,
      realizedPnl30d: null,
      unrealizedPnl: 0,
      peakEquity: 400,
      currentDrawdownPct: 0,
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      totalTrades: 0,
      closedTradesCaptured: 0,
      followers: 0,
    },
    influence: { followers: 0, following: null },
    pnlWindows: { h24: null, d7: null, d30: null, all: null },
    openPositions: open,
    closedTrades: closed,
    equityCurve: [],
    alerts: [],
  };
}

describe('launchpad rotation', () => {
  const book = snap(
    [
      pos({ symbol: 'DEBT', launchpad: 'Pons', launchpadId: 'pons', sizeUsd: 300, unrealizedPnl: 40, change24hPct: 90, narratives: ['Stonks'] }),
      pos({ symbol: 'JOLLY', launchpad: 'Bankr', launchpadId: 'bankr', sizeUsd: 100, unrealizedPnl: -10, change24hPct: -20, narratives: ['Stonks', 'AI / agents'] }),
    ],
    [
      close({ symbol: 'VLAD', launchpad: 'Pons', launchpadId: 'pons', realizedPnl: -15, narratives: ['CT figures'] }),
      close({ symbol: 'WYNJR', launchpad: 'Pons', launchpadId: 'pons', realizedPnl: 25 }),
    ],
  );

  it('sums open, realized, and size-weighted 24h per launchpad', () => {
    const rows = launchpadRotation(book);
    const pons = rows.find((r) => r.key === 'pons')!;
    expect(pons.openNames).toBe(1);
    expect(pons.sizeUsd).toBe(300);
    expect(pons.realizedUsd).toBe(10);
    expect(pons.wins).toBe(1);
    expect(pons.closes).toBe(2);
    expect(pons.totalPnlUsd).toBe(50);
    expect(pons.move24hPct).toBe(90);
    expect(rows[0].key).toBe('pons');
  });

  it('lets a name count toward several narratives', () => {
    const rows = narrativeRotation(book);
    expect(rows.find((r) => r.key === 'Stonks')?.sizeUsd).toBe(400);
    expect(rows.find((r) => r.key === 'Untagged')?.closes).toBe(1);
  });

  it('calls the hottest and coldest bucket', () => {
    expect(rotationCall(launchpadRotation(book))).toBe('Heat: Pons +90.0% · Cold: Bankr -20.0%');
  });
});

describe('closedFromRelaySwaps', () => {
  it('matches sells against buys in the window', () => {
    const usdc = { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', chainId: 792703809 };
    const closes = closedFromRelaySwaps([
      { tokenIn: { ...usdc, amount: 45, usd: 45 }, tokenOut: { symbol: 'VLAD', address: '0xv', chainId: 4663, amount: 100, usd: 43.6 }, at: '2026-09-26T05:27:00Z' },
      { tokenIn: { symbol: 'VLAD', address: '0xv', chainId: 4663, amount: 100, usd: 30 }, tokenOut: { ...usdc, amount: 29, usd: 29 }, at: '2026-09-26T05:29:00Z' },
    ]);
    expect(closes).toHaveLength(1);
    expect(closes[0].symbol).toBe('VLAD');
    expect(closes[0].realizedPnl).toBeCloseTo(-13.6);
    expect(closes[0].notes).toBe('Relay');
  });
});
