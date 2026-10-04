import type { TapeRow, TapeSource } from '../../types/plays.ts';
import { SCAN_CHAINS, droppedSymbol } from './rules.ts';

const DEX = 'https://api.dexscreener.com';
const GECKO = 'https://api.geckoterminal.com/api/v2';
export const TAPE_TTL_MS = 45_000;

interface TapeResult {
  rows: TapeRow[];
  warnings: string[];
  fetchedAt: number;
}

let cache: TapeResult | null = null;
let inflight: Promise<TapeResult> | null = null;

export function clearTapeCache() {
  cache = null;
  inflight = null;
}

async function getJson<T>(url: string, fetchFn: typeof fetch, timeoutMs = 8_000): Promise<T> {
  const res = await fetchFn(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

function key(chain: string, mint: string): string {
  return `${chain}:${mint.startsWith('0x') ? mint.toLowerCase() : mint}`;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positiveOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
}

interface DexListed {
  chainId?: string;
  tokenAddress?: string;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { symbol?: string };
  liquidity?: { usd?: number } | null;
  volume?: { h1?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
  marketCap?: number | null;
  fdv?: number | null;
  pairCreatedAt?: number;
}

interface GeckoPool {
  attributes?: {
    address?: string;
    name?: string;
    reserve_in_usd?: string;
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    pool_created_at?: string;
    price_change_percentage?: { m5?: string; h1?: string; h6?: string };
    transactions?: { h1?: { buys?: number; sells?: number } };
    volume_usd?: { h1?: string };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

export function rowFromDexPair(pair: DexPair, sources: TapeSource[], now = Date.now()): TapeRow | null {
  const mint = pair.baseToken?.address;
  const chain = pair.chainId || '';
  if (!mint || !SCAN_CHAINS.has(chain)) return null;
  return {
    chain,
    mint,
    symbol: pair.baseToken?.symbol || '?',
    name: pair.baseToken?.name || '',
    dexId: pair.dexId || '',
    quoteSymbol: pair.quoteToken?.symbol || '',
    liquidityUsd: num(pair.liquidity?.usd),
    volume1hUsd: num(pair.volume?.h1),
    marketCapUsd: positiveOrNull(pair.marketCap),
    fdvUsd: positiveOrNull(pair.fdv),
    launchedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
    change5mPct: numOrNull(pair.priceChange?.m5),
    change1hPct: numOrNull(pair.priceChange?.h1),
    change6hPct: numOrNull(pair.priceChange?.h6),
    buys1h: numOrNull(pair.txns?.h1?.buys),
    sells1h: numOrNull(pair.txns?.h1?.sells),
    ageHours: pair.pairCreatedAt ? Math.max(0, (now - pair.pairCreatedAt) / 3_600_000) : null,
    pairUrl: pair.url || `https://dexscreener.com/${chain}/${mint}`,
    sources: [...sources],
  };
}

export function rowFromGeckoPool(pool: GeckoPool, source: TapeSource, now = Date.now()): TapeRow | null {
  const a = pool.attributes;
  const baseId = pool.relationships?.base_token?.data?.id || '';
  if (!a || !baseId.startsWith('solana_')) return null;
  const [base = '?', quote = ''] = (a.name || '').split(' / ');
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
  return {
    chain: 'solana',
    mint: baseId.slice('solana_'.length),
    symbol: base.trim(),
    name: base.trim(),
    dexId: pool.relationships?.dex?.data?.id || '',
    quoteSymbol: quote.trim(),
    liquidityUsd: num(a.reserve_in_usd),
    volume1hUsd: num(a.volume_usd?.h1),
    marketCapUsd: positiveOrNull(a.market_cap_usd),
    fdvUsd: positiveOrNull(a.fdv_usd),
    launchedAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    change5mPct: numOrNull(a.price_change_percentage?.m5),
    change1hPct: numOrNull(a.price_change_percentage?.h1),
    change6hPct: numOrNull(a.price_change_percentage?.h6),
    buys1h: numOrNull(a.transactions?.h1?.buys),
    sells1h: numOrNull(a.transactions?.h1?.sells),
    ageHours: Number.isFinite(created) ? Math.max(0, (now - created) / 3_600_000) : null,
    pairUrl: `https://www.geckoterminal.com/solana/pools/${a.address || ''}`,
    sources: [source],
  };
}

function bestPairs(pairs: DexPair[]): Map<string, DexPair> {
  const out = new Map<string, DexPair>();
  for (const p of pairs) {
    const mint = p.baseToken?.address;
    if (!mint || !p.chainId) continue;
    const k = key(p.chainId, mint);
    const prev = out.get(k);
    if (!prev || num(p.liquidity?.usd) > num(prev.liquidity?.usd)) out.set(k, p);
  }
  return out;
}

async function loadTape(fetchFn: typeof fetch): Promise<TapeResult> {
  const warnings: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>, empty: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      warnings.push(`${label}: ${err instanceof Error ? err.message : 'failed'}`);
      return empty;
    }
  };

  const [boosts, profiles, fresh, trending] = await Promise.all([
    settle('Dex boosts', getJson<DexListed[]>(`${DEX}/token-boosts/latest/v1`, fetchFn), []),
    settle('Dex profiles', getJson<DexListed[]>(`${DEX}/token-profiles/latest/v1`, fetchFn), []),
    settle(
      'Gecko new pools',
      getJson<{ data?: GeckoPool[] }>(`${GECKO}/networks/solana/new_pools`, fetchFn),
      { data: [] },
    ),
    settle(
      'Gecko trending',
      getJson<{ data?: GeckoPool[] }>(`${GECKO}/networks/solana/trending_pools?duration=1h`, fetchFn),
      { data: [] },
    ),
  ]);

  const listed = new Map<string, { chain: string; mint: string; sources: TapeSource[] }>();
  const add = (items: DexListed[], source: TapeSource) => {
    for (const it of Array.isArray(items) ? items : []) {
      if (!it.chainId || !it.tokenAddress || !SCAN_CHAINS.has(it.chainId)) continue;
      const k = key(it.chainId, it.tokenAddress);
      const row = listed.get(k) || { chain: it.chainId, mint: it.tokenAddress, sources: [] };
      if (!row.sources.includes(source)) row.sources.push(source);
      listed.set(k, row);
    }
  };
  add(boosts, 'dex-boost');
  add(profiles, 'dex-profile');

  const geckoRows = new Map<string, TapeRow>();
  const gecko: [GeckoPool[], TapeSource][] = [
    [fresh.data || [], 'gecko-new'],
    [trending.data || [], 'gecko-trending'],
  ];
  for (const [pools, source] of gecko) {
    for (const pool of pools) {
      const row = rowFromGeckoPool(pool, source);
      if (!row) continue;
      const k = key(row.chain, row.mint);
      const prev = geckoRows.get(k);
      if (prev) {
        if (!prev.sources.includes(source)) prev.sources.push(source);
      } else {
        geckoRows.set(k, row);
      }
      const listedRow = listed.get(k) || { chain: row.chain, mint: row.mint, sources: [] };
      if (!listedRow.sources.includes(source)) listedRow.sources.push(source);
      listed.set(k, listedRow);
    }
  }

  const byChain = new Map<string, string[]>();
  for (const row of listed.values()) {
    const list = byChain.get(row.chain) || [];
    list.push(row.mint);
    byChain.set(row.chain, list);
  }
  const pairLists = await Promise.all(
    [...byChain.entries()].flatMap(([chain, mints]) => {
      const chunks: string[][] = [];
      for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
      return chunks.map((chunk) =>
        settle(
          `Dex pairs ${chain}`,
          getJson<DexPair[]>(`${DEX}/tokens/v1/${chain}/${chunk.join(',')}`, fetchFn),
          [],
        ),
      );
    }),
  );
  const pairs = bestPairs(pairLists.flat().filter(Boolean));

  const rows = new Map<string, TapeRow>();
  for (const [k, it] of listed) {
    const pair = pairs.get(k);
    const fallback = geckoRows.get(k);
    const row = pair ? rowFromDexPair(pair, it.sources) : fallback ? { ...fallback, sources: it.sources } : null;
    if (row) rows.set(k, row);
  }

  return {
    rows: [...rows.values()].filter((r) => !droppedSymbol(r.symbol)),
    warnings,
    fetchedAt: Date.now(),
  };
}

/** Shared tape for every account, cached for 45s so refreshes don't hammer Dex / Gecko. */
export async function fetchTape(fetchFn: typeof fetch = fetch, now = Date.now()): Promise<TapeResult> {
  if (cache && now - cache.fetchedAt < TAPE_TTL_MS) return cache;
  if (!inflight) {
    inflight = loadTape(fetchFn)
      .then((result) => {
        if (result.rows.length) cache = result;
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
