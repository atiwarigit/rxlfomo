export interface DexPair {
  chainId?: string;
  dexId?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  pairCreatedAt?: number;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string; name?: string };
}

export interface TokenMarket {
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  change24hPct?: number;
  volume24hUsd?: number;
  symbol?: string;
  name?: string;
  quoteSymbol?: string;
}

const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens';

function pickBestPair(pairs: DexPair[], mint: string): DexPair | undefined {
  const lower = mint.toLowerCase();
  // priceUsd is the base token's USD price — ignore pairs where this mint is only the quote.
  const relevant = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === lower);
  return [...relevant].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
}

export async function fetchDexMarkets(
  mints: string[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, TokenMarket>> {
  const out = new Map<string, TokenMarket>();
  const unique = [...new Set(mints.filter(Boolean))];
  const groups = [unique.filter((m) => m.startsWith('0x')), unique.filter((m) => !m.startsWith('0x'))];
  const chunkSize = 10;
  for (const group of groups) {
    for (let i = 0; i < group.length; i += chunkSize) {
      const chunk = group.slice(i, i + chunkSize);
      if (!chunk.length) continue;
    const url = `${DEX_TOKENS}/${chunk.join(',')}`;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { pairs?: DexPair[] } | DexPair[];
      const pairs = Array.isArray(body) ? body : body.pairs ?? [];
      for (const mint of chunk) {
        const best = pickBestPair(pairs, mint);
        if (!best?.priceUsd) continue;
        const priceUsd = Number(best.priceUsd);
        if (!Number.isFinite(priceUsd)) continue;
        const isBase = best.baseToken?.address?.toLowerCase() === mint.toLowerCase();
        const change24hPct = Number(best.priceChange?.h24);
        const row: TokenMarket = {
          priceUsd,
          marketCapUsd: Number(best.marketCap || best.fdv || 0) || 0,
          liquidityUsd: Number(best.liquidity?.usd || 0) || 0,
          change24hPct: Number.isFinite(change24hPct) ? change24hPct : undefined,
          volume24hUsd: Number(best.volume?.h24) || undefined,
          symbol: isBase ? best.baseToken?.symbol : best.quoteToken?.symbol,
          name: isBase ? best.baseToken?.name : best.quoteToken?.name,
          quoteSymbol: isBase ? best.quoteToken?.symbol : best.baseToken?.symbol,
        };
        out.set(mint, row);
        out.set(mint.toLowerCase(), row);
      }
    } catch {
      // keep going; missing prices are handled upstream
    }
    }
  }
  return out;
}

export async function fetchSolPriceUsd(fetchFn: typeof fetch = fetch): Promise<number> {
  try {
    const res = await fetchFn(
      'https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/So11111111111111111111111111111111111111112',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return 0;
    const body = (await res.json()) as {
      data?: { attributes?: { token_prices?: Record<string, string> } };
    };
    const raw =
      body.data?.attributes?.token_prices?.[
        'So11111111111111111111111111111111111111112'
      ];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
