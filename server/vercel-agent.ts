import { AgentError, agentState, confirmIntent, stageIntent, type AgentDeps } from '../src/lib/agent/agent.ts';
import { rpcUrls } from '../src/lib/agent/chain.ts';
import { loadSigner } from '../src/lib/agent/keys.ts';
import { databaseUrl, pgStore } from '../src/lib/agent/store.ts';
import { fetchTape } from '../src/lib/scanner/tape.ts';
import type { IntentRequest } from '../src/types/agent.ts';

type Env = Record<string, string | undefined>;
type Req = { method?: string; body?: unknown };
type Res = {
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
  setHeader: (k: string, v: string) => void;
};

function json(res: Res, status: number, body: unknown) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(status).json(body);
}

function readBody(req: Req): Record<string, unknown> {
  const raw = req.body;
  try {
    if (typeof raw === 'string') return raw ? JSON.parse(raw) : {};
    if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AgentError(400, 'body must be JSON');
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** The signer and database live only here; the browser only ever sees the public address. */
function deps(env: Env): AgentDeps {
  const url = databaseUrl(env);
  const missing = [!url && 'DATABASE_URL', !env.AGENT_SIGNER && 'AGENT_SIGNER'].filter(Boolean);
  if (missing.length) throw new AgentError(503, `agent wallet not set up: ${missing.join(' and ')} missing in server env`);
  return {
    store: pgStore(url),
    signer: loadSigner(env.AGENT_SIGNER),
    rpcUrls: rpcUrls(env),
    env: { JUPITER_API_URL: env.JUPITER_API_URL, JUPITER_API_KEY: env.JUPITER_API_KEY, AGENT_WITHDRAW: env.AGENT_WITHDRAW },
    tape: fetchTape,
  };
}

async function run(res: Res, work: () => Promise<unknown>) {
  try {
    json(res, 200, await work());
  } catch (err) {
    if (err instanceof AgentError) {
      json(res, err.status, { error: err.status === 503 ? 'not_configured' : 'rejected', message: err.message });
      return;
    }
    json(res, 502, { error: 'agent', message: err instanceof Error ? err.message : 'agent route failed' });
  }
}

function only(method: string, req: Req, res: Res): boolean {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (req.method !== method) {
    json(res, 405, { error: 'method', message: `${method} only` });
    return false;
  }
  return true;
}

export async function intentHandler(req: Req, res: Res, env: Env = process.env) {
  if (!only('POST', req, res)) return;
  await run(res, () => {
    const body = readBody(req);
    const request: IntentRequest = {
      handle: String(body.handle ?? ''),
      mint: String(body.mint ?? ''),
      side: body.side as IntentRequest['side'],
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      book: (body.book as IntentRequest['book']) ?? null,
    };
    return stageIntent(deps(env), request);
  });
}

export async function confirmHandler(req: Req, res: Res, env: Env = process.env) {
  if (!only('POST', req, res)) return;
  await run(res, () => confirmIntent(deps(env), String(readBody(req).intentId ?? '')));
}

export async function stateHandler(req: Req, res: Res, env: Env = process.env) {
  if (!only('GET', req, res)) return;
  await run(res, () => agentState(deps(env)));
}
