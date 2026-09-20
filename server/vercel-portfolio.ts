import { loadPortfolio } from '../src/lib/portfolio/load.ts';

export const config = {
  maxDuration: 60,
};

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function headerValue(headers: Query | { get?: (name: string) => string | null }, name: string): string {
  if (headers && typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get: (n: string) => string | null }).get(name) || '';
  }
  const rec = headers as Query;
  return first(rec[name] || rec[name.toLowerCase()]);
}

function queryValue(req: { query?: Query; url?: string }, name: string): string {
  if (req.query) return first(req.query[name]);
  try {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function json(
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader?: (k: string, v: string) => void },
  status: number,
  body: unknown,
) {
  res.setHeader?.('content-type', 'application/json; charset=utf-8');
  res.setHeader?.('cache-control', 'no-store');
  res.status(status).json(body);
}

export default async function handler(
  req: { method?: string; query?: Query; headers: Query; url?: string },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (k: string, v: string) => void;
  },
) {
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const handle = queryValue(req, 'handle') || process.env.FOMO_HANDLE || process.env.VITE_FOMO_HANDLE || '';
    const solanaWallet =
      queryValue(req, 'solana') || process.env.SOLANA_WALLET || process.env.VITE_SOLANA_WALLET || '';
    const evmWallet = queryValue(req, 'evm') || process.env.EVM_WALLET || process.env.VITE_EVM_WALLET || '';
    const apiKey =
      headerValue(req.headers, 'x-fomo-api-key') ||
      process.env.FOMO_API_KEY ||
      process.env.VITE_FOMO_API_KEY ||
      '';

    if (!handle && !solanaWallet) {
      json(res, 400, {
        error: 'config',
        message:
          'Set a FOMO handle and/or a Solana wallet in Settings, or FOMO_HANDLE / SOLANA_WALLET in the environment.',
      });
      return;
    }

    const snapshot = await loadPortfolio({
      handle,
      apiKey,
      solanaWallet,
      evmWallet,
      solanaRpcUrl: process.env.SOLANA_RPC_URL,
      heliusApiKey: process.env.HELIUS_API_KEY,
    });
    json(res, 200, snapshot);
  } catch (err) {
    json(res, 502, {
      error: 'upstream',
      message: err instanceof Error ? err.message : 'Failed to load portfolio',
    });
  }
}
