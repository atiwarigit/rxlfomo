import { ChatConfigError, resolveLlmConfig, runPortfolioChat } from '../src/lib/ai/runChat.ts';
import type { ChatSnapshot, ChatTurn } from '../src/lib/ai/bookContext.ts';

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

type ChatBody = {
  messages?: ChatTurn[];
  snapshot?: ChatSnapshot | null;
  model?: string;
  baseUrl?: string;
};

async function readBody(req: { body?: unknown; on?: (event: string, cb: (...args: unknown[]) => void) => void }): Promise<ChatBody> {
  const raw = req.body;
  if (typeof raw === 'string') {
    try {
      return raw ? (JSON.parse(raw) as ChatBody) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return raw as ChatBody;
  }
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8')) as ChatBody;
    } catch {
      return {};
    }
  }
  return {};
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
  req: { method?: string; headers: Query; body?: unknown },
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
    if (req.method && req.method !== 'POST') {
      json(res, 405, { error: 'method', message: 'POST /api/chat' });
      return;
    }
    const body = await readBody(req);
    const hasUser = (body.messages || []).some((m) => m.role === 'user' && m.content?.trim());
    if (!hasUser) {
      json(res, 400, { error: 'config', message: 'Send a user message' });
      return;
    }
    const llm = resolveLlmConfig(process.env, headerValue(req.headers, 'x-llm-api-key'));
    const result = await runPortfolioChat({
      messages: body.messages || [],
      snapshot: body.snapshot,
      apiKey: llm.apiKey,
      baseUrl: body.baseUrl || llm.baseUrl || undefined,
      model: body.model || llm.model,
    });
    json(res, 200, result);
  } catch (err) {
    const status = err instanceof ChatConfigError ? 400 : 502;
    json(res, status, {
      error: err instanceof ChatConfigError ? 'config' : 'upstream',
      message: err instanceof Error ? err.message : 'Chat failed',
    });
  }
}
