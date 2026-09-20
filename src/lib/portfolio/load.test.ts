import { describe, expect, it, vi } from 'vitest';
import { loadPortfolio } from './load.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('loadPortfolio', () => {
  it('maps FOMO profile, open/closed positions, and skips dust', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v2/users/testtrader/positions')) {
        return jsonResponse({
          available: true,
          closedTotalOnFomo: 12,
          positions: [
            {
              tradeId: 'open-1',
              status: 'open',
              token: { symbol: 'STONK', address: 'Mint111' },
              chain: 'solana',
              amount: 1000,
              avgEntryPrice: 0.05,
              costBasisUsd: 50,
              priceUsd: 0.08,
              unrealizedPnlUsd: 30,
              createdAt: '2026-09-18T00:00:00Z',
            },
            {
              tradeId: 'closed-1',
              status: 'closed',
              token: { symbol: 'MEME', address: 'Mint222' },
              chain: 'solana',
              costBasisUsd: 100,
              avgEntryPrice: 1,
              avgExitPrice: 2,
              realizedPnlUsd: 80,
              createdAt: '2026-09-01T00:00:00Z',
              closedAt: '2026-09-02T00:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/v2/users/testtrader/balances')) {
        return jsonResponse({
          totalValueUsd: 1250,
          holdings: [
            { token: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }, valueUsd: 200, amount: 200, priceUsd: 1, chain: 'solana' },
            { token: { symbol: 'STONK', address: 'Mint111' }, valueUsd: 80, amount: 1000, priceUsd: 0.08, chain: 'solana' },
          ],
        });
      }
      if (url.includes('/v2/leaderboard/all')) {
        return jsonResponse({ traders: [{ handle: 'testtrader', rank: 42 }] });
      }
      if (url.includes('/v2/users/testtrader')) {
        return jsonResponse({
          handle: 'testtrader',
          displayName: 'Test',
          followers: 1200,
          pnlUsd: 900,
          pnl: { '24h': 12, '7d': 40, '30d': 120, all: 900 },
          wallets: { solana: null, evm: null },
          trades: 12,
        });
      }
      if (url.includes('dexscreener')) {
        return jsonResponse({ pairs: [] });
      }
      if (url.includes('geckoterminal')) {
        return jsonResponse({
          data: {
            attributes: {
              token_prices: { So11111111111111111111111111111111111111112: '100' },
            },
          },
        });
      }
      return jsonResponse({ error: 'unmocked ' + url }, 404);
    }) as unknown as typeof fetch;

    const snap = await loadPortfolio({
      handle: 'testtrader',
      apiKey: 'test-key',
      fetchFn,
    });

    expect(snap.handle).toBe('testtrader');
    expect(snap.summary.leaderboardRank).toBe(42);
    expect(snap.summary.followers).toBe(1200);
    expect(snap.summary.realizedPnlAllTime).toBe(900);
    expect(snap.openPositions.some((p) => p.symbol === 'STONK')).toBe(true);
    expect(snap.closedTrades).toHaveLength(1);
    expect(snap.closedTrades[0]?.realizedPnl).toBe(80);
    expect(snap.source.fomo).toBe(true);
    expect(snap.pnlWindows.d7).toBe(40);
  });
});
