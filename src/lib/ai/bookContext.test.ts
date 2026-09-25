import { describe, expect, it } from 'vitest';
import type { PortfolioSnapshot } from '../../types/portfolio.ts';
import { compactBook } from './bookContext.ts';

const snap: PortfolioSnapshot = {
  handle: 'BusyMereDog',
  displayName: 'Busy',
  wallets: { solana: 'So111' },
  source: { fomo: true, onchain: true, fetchedAt: '2026-09-25T12:00:00Z', warnings: ['stale tape'] },
  summary: {
    totalEquity: 8800,
    cashUsd: 0,
    openPositionsValue: 8800,
    realizedPnlAllTime: null,
    realizedPnl7d: null,
    realizedPnl30d: null,
    unrealizedPnl: 1100,
    volumeUsd: 12000,
    peakEquity: 9000,
    currentDrawdownPct: -2.2,
    winRate: 0,
    profitFactor: 0,
    avgRMultiple: 0,
    totalTrades: 4,
    closedTradesCaptured: 0,
    followers: 80,
    leaderboardRank: 12,
  },
  influence: { followers: 80, following: null },
  pnlWindows: { h24: 40, d7: null, d30: null, all: null },
  openPositions: [
    {
      id: 'g',
      token: 'Gascoin',
      symbol: 'GAS',
      chain: 'solana',
      sizeUsd: 4200,
      entryPrice: 1,
      currentPrice: 1.2,
      entryMcap: 0,
      currentMcap: 0,
      unrealizedPnl: 700,
      unrealizedPnlPct: 20,
      holdTimeHours: 40,
      entryDate: '2026-09-20T00:00:00Z',
      source: 'merged',
      change24hPct: 8.5,
      hasCostBasis: true,
      thesis: 'hold the bag',
    },
  ],
  closedTrades: [],
  equityCurve: [],
  alerts: [{ id: 'a1', level: 'warn', message: 'GAS is 47% of the book' }],
};

describe('compactBook', () => {
  it('packs live equity, cash, and open names for the desk prompt', () => {
    const text = compactBook(snap);
    expect(text).toContain('@BusyMereDog');
    expect(text).toContain('Equity: 8800.00');
    expect(text).toContain('Cash: 0.00');
    expect(text).toContain('GAS 4200.00');
    expect(text).toContain('basis=yes');
    expect(text).toContain('Desk rules');
    expect(text).toContain('do not invent fills FOMO did not capture');
  });
});
