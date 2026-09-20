import { describe, expect, it } from 'vitest';
import { positionsFromRelaySwaps } from './relayPositions.ts';

describe('positionsFromRelaySwaps', () => {
  it('keeps leftover Relay inventory with cost basis', () => {
    const rows = positionsFromRelaySwaps([
      {
        tokenIn: {
          symbol: 'USDC',
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 200,
          usd: 200,
          usdNow: 200,
        },
        tokenOut: {
          symbol: 'AGRIPPA',
          address: '0x82ef09793c78f7cb6a2b6696fcdca8e1c3581e18',
          amount: 1000,
          usd: 197,
          usdNow: 107,
          chainId: 4663,
        },
        chain: 'robinhood',
        chainId: 4663,
        at: '2026-09-19T00:00:00Z',
      },
    ]);
    const agrippa = rows.find((p) => p.symbol === 'AGRIPPA');
    expect(agrippa?.hasCostBasis).toBe(true);
    expect(agrippa?.chain).toBe('robinhood');
    expect(agrippa?.sizeUsd).toBeCloseTo(107);
    expect(agrippa?.unrealizedPnl).toBeCloseTo(-90);
  });
});
