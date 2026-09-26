import type { Chain } from '../../types/portfolio.ts';
import {
  DIRECT_LAUNCH,
  launchpadFromDexIds,
  launchpadFromMint,
  narrativesFor,
  pairLaunch,
  type LaunchpadInfo,
} from './classify.ts';

export interface TokenMeta {
  launchpad: LaunchpadInfo;
  narratives: string[];
  quote?: string;
  name?: string;
}

const GT = 'https://api.geckoterminal.com/api/v2/networks';

const NETWORK: Partial<Record<Chain, string>> = {
  solana: 'solana',
  robinhood: 'robinhood',
  base: 'base',
  ethereum: 'eth',
  bnb: 'bsc',
};

// Launchpad + pairing never change for a token, so warm serverless instances keep them.
const cache = new Map<string, TokenMeta>();

export interface MetaRequest {
  address: string;
  chain: Chain | string;
  symbol?: string;
}

interface GtToken {
  attributes?: { address?: string; symbol?: string; name?: string };
  relationships?: { top_pools?: { data?: { id: string }[] } };
}

interface GtPool {
  id: string;
  attributes?: { name?: string };
  relationships?: { dex?: { data?: { id?: string } } };
}

function quoteFromPoolName(poolName: string | undefined, symbol: string): string | undefined {
  if (!poolName) return undefined;
  const sides = poolName.split('/').map((s) => s.trim().split(/\s+/)[0]);
  if (sides.length < 2) return undefined;
  const other = sides.find((s) => s.toLowerCase() !== symbol.toLowerCase());
  return other || sides[1];
}

export function metaFromGecko(token: GtToken, pools: Map<string, GtPool>): TokenMeta {
  const symbol = token.attributes?.symbol || '';
  const name = token.attributes?.name || '';
  const top = (token.relationships?.top_pools?.data ?? [])
    .map((p) => pools.get(p.id))
    .filter((p): p is GtPool => Boolean(p));
  const dexIds = top.map((p) => p.relationships?.dex?.data?.id || '').filter(Boolean);
  const quote = quoteFromPoolName(top[0]?.attributes?.name, symbol);
  const launchpad =
    launchpadFromDexIds(dexIds) ||
    launchpadFromMint(token.attributes?.address) ||
    pairLaunch(quote) ||
    DIRECT_LAUNCH;
  return { launchpad, quote, name, narratives: narrativesFor({ symbol, name, quote }) };
}

const key = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`;

export async function fetchTokenMeta(
  requests: MetaRequest[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  const byNetwork = new Map<string, MetaRequest[]>();
  for (const r of requests) {
    if (!r.address) continue;
    const k = key(String(r.chain), r.address);
    const hit = cache.get(k);
    if (hit) {
      out.set(r.address.toLowerCase(), hit);
      continue;
    }
    const net = NETWORK[r.chain as Chain];
    if (!net) continue;
    const list = byNetwork.get(net) ?? [];
    if (!list.some((x) => x.address.toLowerCase() === r.address.toLowerCase())) list.push(r);
    byNetwork.set(net, list);
  }

  for (const [net, list] of byNetwork) {
    for (let i = 0; i < list.length; i += 30) {
      const chunk = list.slice(i, i + 30);
      try {
        const res = await fetchFn(
          `${GT}/${net}/tokens/multi/${chunk.map((c) => c.address).join(',')}?include=top_pools`,
          { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } },
        );
        if (!res.ok) continue;
        const body = (await res.json()) as { data?: GtToken[]; included?: GtPool[] };
        const pools = new Map((body.included ?? []).map((p) => [p.id, p]));
        for (const t of body.data ?? []) {
          const addr = t.attributes?.address?.toLowerCase();
          if (!addr) continue;
          const meta = metaFromGecko(t, pools);
          const req = chunk.find((c) => c.address.toLowerCase() === addr);
          cache.set(key(String(req?.chain ?? net), addr), meta);
          out.set(addr, meta);
        }
      } catch {
        // launchpad tags are best-effort; positions still render
      }
    }
  }

  for (const r of requests) {
    const addr = r.address?.toLowerCase();
    if (!addr || out.has(addr)) continue;
    const launchpad = launchpadFromMint(r.address);
    if (launchpad) {
      out.set(addr, { launchpad, narratives: narrativesFor({ symbol: r.symbol }) });
    }
  }
  return out;
}
