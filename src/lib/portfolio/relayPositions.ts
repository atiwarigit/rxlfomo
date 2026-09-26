import type { FomoRelaySwap } from '../fomo/types.ts';
import type { ClosedTrade, Position } from '../../types/portfolio.ts';
import { asNumber, hoursBetween, isCashAsset, normalizeChain } from './helpers.ts';

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
  firstBuyAt?: string;
  lastSellAt?: string;
}

function tokenKey(address?: string, symbol?: string, chainId?: number): string {
  return `${(address || symbol || '').toLowerCase()}::${chainId ?? ''}`;
}

function earlier(a?: string, b?: string) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a?: string, b?: string) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function accumulate(swaps: FomoRelaySwap[]): Map<string, Acc> {
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
      prev.firstBuyAt = earlier(prev.firstBuyAt, at);
    } else {
      prev.soldAmount += amount;
      prev.soldUsd += usd;
      prev.lastSellAt = later(prev.lastSellAt, at);
    }
    prev.chain = prev.chain || chain;
    prev.lastAt = later(prev.lastAt, at);
    map.set(key, prev);
  };

  for (const swap of swaps) {
    bump(swap.tokenOut, swap.toChain || swap.chain, swap.chainId, swap.at, 'buy');
    bump(swap.tokenIn, swap.fromChain || swap.chain, swap.tokenIn?.chainId ?? swap.chainId, swap.at, 'sell');
  }
  return map;
}

export function positionsFromRelaySwaps(swaps: FomoRelaySwap[]): Position[] {
  const out: Position[] = [];
  for (const row of accumulate(swaps).values()) {
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
      holdTimeHours: hoursBetween(row.firstBuyAt),
      entryDate: row.firstBuyAt || row.lastAt || new Date().toISOString(),
      source: 'fomo',
      hasCostBasis: cost > 0,
    });
  }
  return out;
}

/** Realized rounds: sells matched against the buys seen in the same Relay window. */
export function closedFromRelaySwaps(swaps: FomoRelaySwap[]): ClosedTrade[] {
  const out: ClosedTrade[] = [];
  for (const row of accumulate(swaps).values()) {
    if (isCashAsset(row.symbol, row.address)) continue;
    if (row.boughtAmount <= 0 || row.soldAmount <= 0) continue;
    // Sells beyond what this window bought belong to older buys we can't cost.
    const matched = Math.min(row.soldAmount, row.boughtAmount);
    const soldFrac = matched / row.boughtAmount;
    const cost = row.boughtUsd * soldFrac;
    if (cost <= 0) continue;
    const proceeds = row.soldUsd * (matched / row.soldAmount);
    const realized = proceeds - cost;
    const remainingFrac = 1 - soldFrac;
    const entryPrice = row.boughtUsd / row.boughtAmount;
    const exitPrice = proceeds / matched;
    out.push({
      id: `relay-close-${row.address}`,
      token: row.symbol,
      symbol: row.symbol,
      mint: row.address,
      chain: normalizeChain(row.chain, row.chainId),
      side: 'long',
      sizeUsd: cost,
      entryPrice,
      exitPrice,
      realizedPnl: realized,
      realizedPnlPct: (realized / cost) * 100,
      holdTimeHours: hoursBetween(row.firstBuyAt, row.lastSellAt),
      entryDate: row.firstBuyAt || row.lastAt || new Date().toISOString(),
      exitDate: row.lastSellAt || row.lastAt || new Date().toISOString(),
      notes: remainingFrac > 0.01 ? 'partial exit (Relay)' : 'Relay',
    });
  }
  return out;
}
