import { describe, expect, it } from 'vitest';
import type { PortfolioSnapshot, Position } from '../../types/portfolio.ts';
import { heroSlots, sizeBoard } from './heroes.ts';

function pos(over: Partial<Position>): Position {
  return {
    id: over.id || '1',
    token: over.symbol || 'APE',
    symbol: 'APE',
    chain: 'solana',
    sizeUsd: 100,
    entryPrice: 1,
    currentPrice: 1,
    entryMcap: 0,
    currentMcap: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 1,
    entryDate: '2026-09-25T00:00:00Z',
    source: 'onchain',
    ...over,
  };
}

const emptySummary: PortfolioSnapshot['summary'] = {
  totalEquity: 1000,
  cashUsd: 250,
  openPositionsValue: 750,
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
};

function snap(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    wallets: {},
    source: { fomo: false, onchain: true, fetchedAt: '2026-09-25T00:00:00Z', warnings: [] },
    summary: emptySummary,
    influence: { followers: 0, following: null },
    pnlWindows: { h24: 0, d7: null, d30: null, all: null },
    openPositions: [],
    closedTrades: [],
    equityCurve: [],
    alerts: [],
    ...over,
  };
}

describe('heroSlots', () => {
  it('ranks the largest bags and fills with cash', () => {
    const slots = heroSlots(
      snap({
        openPositions: [
          pos({ id: 'a', symbol: 'BIG', sizeUsd: 400 }),
          pos({ id: 'b', symbol: 'MID', sizeUsd: 200 }),
        ],
      }),
    );
    expect(slots).toHaveLength(3);
    expect(slots[0]?.label).toBe('BIG');
    expect(slots[0]?.rank).toBe(1);
    expect(slots[1]?.behindUsd).toBe(200);
    expect(slots[2]?.kind).toBe('cash');
    expect(slots[2]?.sizeUsd).toBe(250);
  });

  it('pads idle desks so the floor stays three-wide', () => {
    const slots = heroSlots(snap({ openPositions: [] }));
    expect(slots.map((s) => s.kind)).toEqual(['cash', 'idle', 'idle']);
  });
});

describe('sizeBoard', () => {
  it('includes cash when there is room', () => {
    const rows = sizeBoard(snap({ openPositions: [pos({ sizeUsd: 400 })] }), 4);
    expect(rows[0]?.label).toBe('APE');
    expect(rows.some((r) => r.label === 'CASH')).toBe(true);
  });
});
