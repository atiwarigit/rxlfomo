import type { FomoRelaySwap, FomoRelayToken } from '../fomo/types.ts';

const RELAY_REQUESTS = 'https://api.relay.link/requests/v2';
const RELAY_SOLANA_CHAIN_ID = 792703809;

interface RelayCurrencyAmount {
  currency?: { chainId?: number; address?: string; symbol?: string };
  amountFormatted?: string;
  amountUsd?: string;
  amountUsdCurrent?: string;
}

interface RelayRequest {
  id?: string;
  status?: string;
  user?: string;
  recipient?: string;
  createdAt?: string;
  data?: {
    metadata?: {
      sender?: string;
      recipient?: string;
      currencyIn?: RelayCurrencyAmount;
      currencyOut?: RelayCurrencyAmount;
    };
  };
}

export interface RelayHistory {
  swaps: FomoRelaySwap[];
  evmWallet?: string;
  truncated: boolean;
  rateLimited?: boolean;
}

function chainName(chainId?: number): string | undefined {
  if (chainId === RELAY_SOLANA_CHAIN_ID) return 'solana';
  if (chainId === 4663) return 'robinhood';
  if (chainId === 8453) return 'base';
  if (chainId === 56) return 'bnb';
  if (chainId === 1) return 'ethereum';
  return undefined;
}

function toToken(c?: RelayCurrencyAmount): FomoRelayToken | undefined {
  if (!c?.currency) return undefined;
  const amount = Number(c.amountFormatted);
  const usd = Number(c.amountUsd);
  const usdNow = Number(c.amountUsdCurrent);
  return {
    address: c.currency.address,
    symbol: c.currency.symbol,
    chainId: c.currency.chainId,
    amount: Number.isFinite(amount) ? amount : 0,
    usd: Number.isFinite(usd) ? usd : 0,
    usdNow: Number.isFinite(usdNow) ? usdNow : undefined,
  };
}

export function swapsFromRelayRequests(requests: RelayRequest[]): RelayHistory {
  const swaps: FomoRelaySwap[] = [];
  const recipients = new Map<string, number>();
  for (const r of requests) {
    if (r.status !== 'success') continue;
    const m = r.data?.metadata;
    const tokenIn = toToken(m?.currencyIn);
    const tokenOut = toToken(m?.currencyOut);
    if (!tokenIn || !tokenOut) continue;
    const recipient = m?.recipient || r.recipient;
    if (recipient?.startsWith('0x')) {
      recipients.set(recipient.toLowerCase(), (recipients.get(recipient.toLowerCase()) ?? 0) + 1);
    }
    swaps.push({
      swapId: r.id,
      fromChain: chainName(tokenIn.chainId),
      toChain: chainName(tokenOut.chainId),
      chainId: tokenOut.chainId,
      tokenIn,
      tokenOut,
      status: r.status,
      at: r.createdAt,
      source: 'relay',
    });
  }
  const evmWallet = [...recipients.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { swaps, evmWallet, truncated: false };
}

const HISTORY_TTL_MS = 3 * 60_000;
const historyCache = new Map<string, { at: number; history: RelayHistory }>();

/** Public Relay history for a wallet — no FOMO credits needed. */
export async function fetchRelayHistory(
  user: string,
  fetchFn: typeof fetch = fetch,
  maxPages = 8,
): Promise<RelayHistory> {
  const key = user.toLowerCase();
  const cached = historyCache.get(key);
  const fresh = cached && Date.now() - cached.at < HISTORY_TTL_MS;
  if (fresh && !cached.history.rateLimited) return cached.history;
  try {
    const history = await fetchRelayPages(user, fetchFn, maxPages);
    // A rate-limited partial read must not replace a fuller recent one.
    if (cached && history.rateLimited && cached.history.swaps.length > history.swaps.length) {
      return cached.history;
    }
    historyCache.set(key, { at: Date.now(), history });
    return history;
  } catch (err) {
    if (cached) return cached.history;
    throw err;
  }
}

async function fetchRelayPages(
  user: string,
  fetchFn: typeof fetch,
  maxPages: number,
): Promise<RelayHistory> {
  const all: RelayRequest[] = [];
  let continuation: string | undefined;
  let pages = 0;
  let stoppedEarly = false;
  do {
    const params = new URLSearchParams({ user, limit: '50' });
    if (continuation) params.set('continuation', continuation);
    const body = await fetchPage(`${RELAY_REQUESTS}?${params}`, fetchFn);
    if (!body) {
      if (!all.length) throw new Error('Relay rate-limited or unavailable');
      stoppedEarly = true;
      break;
    }
    all.push(...(body.requests ?? []));
    continuation = body.continuation || undefined;
    pages += 1;
  } while (continuation && pages < maxPages);
  const history = swapsFromRelayRequests(all);
  return { ...history, truncated: stoppedEarly || Boolean(continuation), rateLimited: stoppedEarly };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(
  url: string,
  fetchFn: typeof fetch,
): Promise<{ requests?: RelayRequest[]; continuation?: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return (await res.json()) as { requests?: RelayRequest[]; continuation?: string };
      if (res.status !== 429 && res.status < 500) return null;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 800 * 2 ** attempt);
    } catch {
      await sleep(800 * 2 ** attempt);
    }
  }
  return null;
}
