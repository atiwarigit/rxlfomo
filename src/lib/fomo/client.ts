import type {
  FomoBalancesResponse,
  FomoLeaderboardResponse,
  FomoPositionsResponse,
  FomoUser,
} from './types.ts';

const DEFAULT_BASE = 'https://api.fomoapi.io';

export class FomoApiError extends Error {
  status: number;
  code: 'auth' | 'credits' | 'not_found' | 'upstream';
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    if (status === 401) this.code = 'auth';
    else if (status === 402) this.code = 'credits';
    else if (status === 404) this.code = 'not_found';
    else this.code = 'upstream';
  }
}

export interface FomoClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

function headers(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json',
  };
}

async function getJson<T>(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
): Promise<T> {
  const res = await fetchFn(url, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const errObj = body as { error?: string; message?: string } | null;
    throw new FomoApiError(
      res.status,
      errObj?.message || errObj?.error || `FOMO API ${res.status}`,
      body,
    );
  }
  return body as T;
}

export function createFomoClient(opts: FomoClientOptions) {
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const fetchFn = opts.fetchFn ?? fetch;
  const key = opts.apiKey;

  return {
    resolveUser(handle: string) {
      const h = encodeURIComponent(handle.replace(/^@/, ''));
      return getJson<FomoUser>(fetchFn, `${base}/v2/users/${h}`, key);
    },
    positions(handle: string, query = 'deep=1&limit=500') {
      const h = encodeURIComponent(handle.replace(/^@/, ''));
      return getJson<FomoPositionsResponse>(
        fetchFn,
        `${base}/v2/users/${h}/positions?${query}`,
        key,
      );
    },
    balances(handle: string) {
      const h = encodeURIComponent(handle.replace(/^@/, ''));
      return getJson<FomoBalancesResponse>(
        fetchFn,
        `${base}/v2/users/${h}/balances`,
        key,
      );
    },
    leaderboard(window: '24h' | '7d' | '30d' | 'all' = 'all', limit = 150) {
      return getJson<FomoLeaderboardResponse>(
        fetchFn,
        `${base}/v2/leaderboard/${window}?limit=${limit}`,
        key,
      );
    },
  };
}

export type FomoClient = ReturnType<typeof createFomoClient>;
