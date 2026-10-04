import { loadPortfolio } from '../src/lib/portfolio/load.ts';
import { RULES, buildPlays } from '../src/lib/scanner/rules.ts';
import { fetchTape } from '../src/lib/scanner/tape.ts';
import type { PortfolioSnapshot } from '../src/types/portfolio.ts';
import type { PlaysResponse } from '../src/types/plays.ts';
import { knownWallets, sameHandle } from './knownWallets.ts';

export const config = {
  maxDuration: 60,
};

type Query = Record<string, string | string[] | undefined>;

const BOOK_TTL_MS = 90_000;
const books = new Map<string, { at: number; snap: PortfolioSnapshot }>();

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function queryValue(req: { query?: Query; url?: string }, name: string): string {
  if (req.query) return first(req.query[name]);
  try {
    return new URL(req.url || '', 'http://localhost').searchParams.get(name) || '';
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

/** Same loader as /api/portfolio, but without a FOMO key: the scanner never spends fomoapi credits. */
async function readBook(
  handle: string,
  wallets: { solana: string; evm: string },
  env: Record<string, string | undefined>,
): Promise<PortfolioSnapshot> {
  const k = `${handle.toLowerCase()}|${wallets.solana}|${wallets.evm}`;
  const hit = books.get(k);
  if (hit && Date.now() - hit.at < BOOK_TTL_MS) return hit.snap;
  const snap = await loadPortfolio({
    handle,
    apiKey: '',
    solanaWallet: wallets.solana,
    evmWallet: wallets.evm,
    solanaRpcUrl: env.SOLANA_RPC_URL,
    heliusApiKey: env.HELIUS_API_KEY,
  });
  if (snap.source.onchain) books.set(k, { at: Date.now(), snap });
  return snap;
}

export default async function handler(
  req: { method?: string; query?: Query; headers?: Query; url?: string },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (k: string, v: string) => void;
  },
  env: Record<string, string | undefined> = process.env,
) {
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method && req.method !== 'GET') {
      json(res, 405, { error: 'method', message: 'GET /api/plays?handle=' });
      return;
    }
    const defaultHandle = env.FOMO_HANDLE || env.VITE_FOMO_HANDLE || '';
    const handle = (queryValue(req, 'handle') || defaultHandle).replace(/^@/, '').trim();
    if (!handle) {
      json(res, 400, { error: 'config', message: 'GET /api/plays?handle=<fomo handle>' });
      return;
    }
    const envWallets = sameHandle(handle, defaultHandle)
      ? { solana: env.SOLANA_WALLET || '', evm: env.EVM_WALLET || '' }
      : { solana: '', evm: '' };
    const known = knownWallets(handle);
    const wallets = {
      solana:
        queryValue(req, 'solana') || envWallets.solana || known.solana || queryValue(req, 'solanaHint'),
      evm: queryValue(req, 'evm') || envWallets.evm || known.evm || queryValue(req, 'evmHint'),
    };

    const [snap, tape] = await Promise.all([readBook(handle, wallets, env), fetchTape()]);
    const { book, plays } = buildPlays({ handle, book: snap, tape: tape.rows });
    const body: PlaysResponse = {
      generatedAt: new Date().toISOString(),
      tapeCount: tape.rows.length,
      rules: RULES,
      books: [book],
      plays,
    };
    json(res, 200, body);
  } catch (err) {
    json(res, 502, {
      error: 'upstream',
      message: err instanceof Error ? err.message : 'Failed to read plays',
    });
  }
}
