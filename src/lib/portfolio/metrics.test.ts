import { describe, expect, it } from 'vitest';
import { isCashAsset, normalizeChain, pnlFromChangePct } from './helpers.ts';
import { buildAlerts, buildEquityCurve, statsFromClosed } from './metrics.ts';
import type { ClosedTrade, Position } from '../../types/portfolio.ts';

const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  id: '1',
  token: 'MEME',
  symbol: 'MEME',
  chain: 'solana',
  side: 'long',
  sizeUsd: 10_000,
  entryPrice: 1,
  exitPrice: 2,
  realizedPnl: 5_000,
  realizedPnlPct: 50,
  holdTimeHours: 12,
  entryDate: '2026-09-01T00:00:00Z',
  exitDate: '2026-09-10T00:00:00Z',
  ...over,
});

describe('helpers', () => {
  it('treats SOL and USDC as cash', () => {
    expect(isCashAsset('SOL')).toBe(true);
    expect(isCashAsset('USDC')).toBe(true);
    expect(isCashAsset('STONK')).toBe(false);
  });

  it('maps network ids to chains', () => {
    expect(normalizeChain(undefined, 1399811149)).toBe('solana');
    expect(normalizeChain('base', 8453)).toBe('base');
    expect(normalizeChain('robinhood', 4663)).toBe('robinhood');
  });

  it('converts a 24h percent move into USD PnL at the current mark', () => {
    expect(pnlFromChangePct(100, 25)).toBeCloseTo(20);
    expect(pnlFromChangePct(50, -50)).toBeCloseTo(-50);
  });
});

describe('closed-trade stats', () => {
  it('computes win rate, profit factor, and R', () => {
    const stats = statsFromClosed([
      trade({ id: 'w', realizedPnl: 20_000 }),
      trade({
        id: 'l',
        realizedPnl: -5_000,
        exitDate: '2026-09-11T00:00:00Z',
      }),
    ]);
    expect(stats.winRate).toBe(50);
    expect(stats.profitFactor).toBe(4);
    expect(stats.totalTrades).toBe(2);
  });
});

describe('equity curve + alerts', () => {
  it('builds a curve that ends at current equity', () => {
    const curve = buildEquityCurve(
      [trade({ realizedPnl: 100_000, exitDate: '2026-09-01T00:00:00Z' })],
      1_000_000,
      100_000,
      50_000,
    );
    expect(curve.at(-1)?.equity).toBe(1_000_000);
    expect(curve[0]?.equity).toBe(950_000);
  });

  it('flags oversized names and low cash', () => {
    const positions: Position[] = [
      {
        id: '1',
        token: 'APE',
        symbol: 'APE',
        chain: 'solana',
        sizeUsd: 400_000,
        entryPrice: 1,
        currentPrice: 1,
        entryMcap: 0,
        currentMcap: 0,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        holdTimeHours: 1,
        entryDate: '2026-09-20T00:00:00Z',
        source: 'fomo',
      },
    ];
    const alerts = buildAlerts(1_000_000, 50_000, positions, -12);
    expect(alerts.some((a) => a.id === 'size-single')).toBe(true);
    expect(alerts.some((a) => a.id === 'cash-floor')).toBe(true);
    expect(alerts.some((a) => a.id === 'drawdown')).toBe(true);
  });
});
