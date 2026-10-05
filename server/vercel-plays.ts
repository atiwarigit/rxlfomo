import { RULES, buildRunners } from '../src/lib/scanner/rules.ts';
import { fetchTape } from '../src/lib/scanner/tape.ts';
import type { PlaysResponse } from '../src/types/plays.ts';

export const config = {
  maxDuration: 30,
};

type Query = Record<string, string | string[] | undefined>;

const lastBoard = new Map<string, Set<string>>();

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

/**
 * Live runner board for one handle, rebuilt from the tape on every call (tape TTL 12s).
 * Never loads the portfolio: book vetoes, held mints and fit come from the snapshot on the page.
 */
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
    const k = handle.toLowerCase();
    const tape = await fetchTape();
    const plays = buildRunners({ handle, tape: tape.rows, previous: lastBoard.get(k) });
    lastBoard.set(k, new Set(plays.map((p) => (p.mint.startsWith('0x') ? p.mint.toLowerCase() : p.mint))));
    const body: PlaysResponse = {
      generatedAt: new Date(tape.fetchedAt).toISOString(),
      tapeCount: tape.rows.length,
      rules: RULES,
      books: [],
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
