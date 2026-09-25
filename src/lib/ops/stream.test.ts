import { describe, expect, it } from 'vitest';
import type { PortfolioSnapshot, Position } from '../../types/portfolio.ts';
import { buildDecisionStream } from './stream.ts';

function pos(over: Partial<Position>): Position {
  return {
    id: '1',
    token: 'APE',
    symbol: 'APE',
    chain: 'solana',
    sizeUsd: 400,
    entryPrice: 1,
    currentPrice: 1.2,
    entryMcap: 0,
    currentMcap: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 9,
    entryDate: '2026-09-25T00:00:00Z',
    source: 'onchain',
    ...over,
  };
}

function snap(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    wallets: {},
    source: { fomo: false, onchain: true, fetchedAt: '2026-09-25T00:00:00Z', warnings: [] },
    summary: {
      totalEquity: 1000,
      cashUsd: 200,
      openPositionsValue: 800,
      realizedPnlAllTime: null,
      realizedPnl7d: null,
      realizedPnl30d: null,
      unrealizedPnl: 0,
      peakEquity: 1000,
      currentDrawdownPct: 0,
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      totalTrades: 0,
      closedTradesCaptured: 0,
      followers: 0,
    },
    influence: { followers: 0, following: null },
    pnlWindows: { h24: 0, d7: null, d30: null, all: null },
    openPositions: [],
    closedTrades: [],
    equityCurve: [],
    alerts: [],
    ...over,
  };
}

describe('buildDecisionStream', () => {
  it('emits RIDE on a large green 24h print', () => {
    const events = buildDecisionStream(
      snap({
        openPositions: [pos({ id: 'g', change24hPct: 12, sizeUsd: 200 })],
      }),
    );
    expect(events.some((e) => e.action === 'RIDE' && e.actor === 'APE')).toBe(true);
    expect(events.some((e) => e.action === 'LONG')).toBe(true);
  });

  it('emits FADE on a large red 24h print', () => {
    const events = buildDecisionStream(
      snap({
        openPositions: [pos({ id: 'r', change24hPct: -11, sizeUsd: 80 })],
      }),
    );
    expect(events.some((e) => e.action === 'FADE')).toBe(true);
  });
});
