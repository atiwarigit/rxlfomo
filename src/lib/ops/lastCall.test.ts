import { describe, expect, it } from 'vitest';
import type { Position } from '../../types/portfolio.ts';
import { lastCallForCash, lastCallForPosition } from './lastCall.ts';

const base: Position = {
  id: '1',
  token: 'GAS',
  symbol: 'GAS',
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
};

describe('lastCall', () => {
  it('calls RIDE on a strong green print', () => {
    const call = lastCallForPosition({ ...base, change24hPct: 14, hasCostBasis: true });
    expect(call.action).toBe('RIDE');
    expect(call.bars[0]?.label).toBe('RIDE');
  });

  it('calls FADE_LONG_* on a dump', () => {
    const call = lastCallForPosition({ ...base, change24hPct: -12 });
    expect(call.action).toBe('FADE_LONG_GAS');
  });

  it('flags a tight cash book', () => {
    expect(lastCallForCash(5).action).toBe('WAIT_CASH');
    expect(lastCallForCash(40).action).toBe('FLAT');
  });
});
