import { describe, expect, it } from 'vitest';
import { positionsFromRelaySwaps } from '../portfolio/relayPositions.ts';
import { swapsFromRelayRequests } from './api.ts';

const usdcSol = { chainId: 792703809, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' };
const debt = { chainId: 4663, address: '0x5b32971ee68b1ed6d11476760106f29d81f77f6e', symbol: 'DEBT' };
const vlad = { chainId: 4663, address: '0xvlad', symbol: 'VLAD' };

describe('swapsFromRelayRequests', () => {
  it('turns Relay bridges into Robinhood bags and finds the EVM wallet', () => {
    const history = swapsFromRelayRequests([
      {
        status: 'success',
        createdAt: '2026-09-26T12:29:00Z',
        data: {
          metadata: {
            recipient: '0x06953A582F054B7B7C4C6DD890777E3958B4A673',
            currencyIn: { currency: usdcSol, amountFormatted: '26.45', amountUsd: '26.45', amountUsdCurrent: '26.45' },
            currencyOut: { currency: debt, amountFormatted: '173798', amountUsd: '25.84', amountUsdCurrent: '28.40' },
          },
        },
      },
      {
        status: 'success',
        data: {
          metadata: {
            recipient: '0x06953a582f054b7b7c4c6dd890777e3958b4a673',
            currencyIn: { currency: usdcSol, amountFormatted: '45', amountUsd: '45', amountUsdCurrent: '45' },
            currencyOut: { currency: vlad, amountFormatted: '100', amountUsd: '43', amountUsdCurrent: '50' },
          },
        },
      },
      {
        status: 'success',
        data: {
          metadata: {
            recipient: 'SolWallet',
            currencyIn: { currency: vlad, amountFormatted: '100', amountUsd: '43.3', amountUsdCurrent: '50' },
            currencyOut: { currency: usdcSol, amountFormatted: '41.8', amountUsd: '41.8', amountUsdCurrent: '41.8' },
          },
        },
      },
      { status: 'failure', data: { metadata: {} } },
    ]);
    expect(history.evmWallet).toBe('0x06953a582f054b7b7c4c6dd890777e3958b4a673');
    expect(history.swaps).toHaveLength(3);

    const open = positionsFromRelaySwaps(history.swaps);
    const bag = open.find((p) => p.symbol === 'DEBT');
    expect(bag?.chain).toBe('robinhood');
    expect(bag?.sizeUsd).toBeCloseTo(28.4);
    expect(bag?.unrealizedPnl).toBeCloseTo(2.56);
    expect(open.some((p) => p.symbol === 'VLAD')).toBe(false);
  });
});
