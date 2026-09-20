import type { FomoRelaySwap } from '../fomo/types.ts';
import type { Position } from '../../types/portfolio.ts';
import { asNumber, isCashAsset, normalizeChain } from './helpers.ts';

const DUST_USD = 5;

interface Acc {
  symbol: string;
  address: string;
  chain?: string;
  chainId?: number;
  boughtAmount: number;
  boughtUsd: number;
  boughtUsdNow: number;
  soldAmount: number;
  soldUsd: number;
  lastAt?: string;
}

function tokenKey(address?: string, symbol?: string, chainId?: number): string {
  return `${(address || symbol || '').toLowerCase()}::${chainId ?? ''}`;
}

export function positionsFromRelaySwaps(swaps: FomoRelaySwap[]): Position[] {
  const map = new Map<string, Acc>();

  const bump = (
    token: FomoRelaySwap['tokenOut'] | FomoRelaySwap['tokenIn'],
    chain: string | undefined,
    fallbackChainId: number | undefined,
    at: string | undefined,
    side: 'buy' | 'sell',
  ) => {
    if (!token) return;
    const symbol = token.symbol || 'UNKNOWN';
    const address = token.address || symbol;
    const chainId = token.chainId ?? fallbackChainId;
    const key = tokenKey(address, symbol, chainId);
    const prev = map.get(key) ?? {
      symbol,
      address,
      chain,
      chainId,
      boughtAmount: 0,
      boughtUsd: 0,
      boughtUsdNow: 0,
      soldAmount: 0,
      soldUsd: 0,
      lastAt: at,
    };
    const amount = asNumber(token.amount);
    const usd = asNumber(token.usd);
    const usdNow = asNumber(token.usdNow);
    if (side === 'buy') {
      prev.boughtAmount += amount;
      prev.boughtUsd += usd;
      prev.boughtUsdNow += usdNow || usd;
    } else {
      prev.soldAmount += amount;
      prev.soldUsd += usd;
    }
    prev.chain = prev.chain || chain;
    prev.lastAt = at || prev.lastAt;
    map.set(key, prev);
  };

  for (const swap of swaps) {
    bump(swap.tokenOut, swap.toChain || swap.chain, swap.chainId, swap.at, 'buy');
    bump(swap.tokenIn, swap.fromChain || swap.chain, swap.tokenIn?.chainId ?? swap.chainId, swap.at, 'sell');
  }

  const out: Position[] = [];
  for (const row of map.values()) {
    const remaining = row.boughtAmount - row.soldAmount;
    if (remaining <= 0) continue;
    const frac = row.boughtAmount > 0 ? remaining / row.boughtAmount : 0;
    const cost = row.boughtUsd * frac;
    const value = (row.boughtUsdNow > 0 ? row.boughtUsdNow : row.boughtUsd) * frac;
    if (value < DUST_USD && !isCashAsset(row.symbol, row.address)) continue;
    const entry = remaining > 0 ? cost / remaining : 0;
    const price = remaining > 0 ? value / remaining : 0;
    const unrealized = value - cost;
    out.push({
      id: `relay-${row.address}`,
      token: row.symbol,
      symbol: row.symbol,
      mint: row.address,
      chain: normalizeChain(row.chain, row.chainId),
      sizeUsd: value,
      amount: remaining,
      entryPrice: entry,
      currentPrice: price,
      entryMcap: 0,
      currentMcap: 0,
      unrealizedPnl: unrealized,
      unrealizedPnlPct: cost > 0 ? (unrealized / cost) * 100 : 0,
      holdTimeHours: 0,
      entryDate: row.lastAt || new Date().toISOString(),
      source: 'fomo',
      hasCostBasis: cost > 0,
    });
  }
  return out;
}
