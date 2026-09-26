import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { loadPortfolio } from '../src/lib/portfolio/load.ts';
import chatHandler from './vercel-chat.ts';
import { knownWallets, sameHandle } from './knownWallets.ts';

function readUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', 'http://localhost');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function handlePortfolio(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string>,
) {
  const url = readUrl(req);
  const defaultHandle = env.FOMO_HANDLE || env.VITE_FOMO_HANDLE || '';
  const handle = url.searchParams.get('handle') || defaultHandle;
  const envWallets = sameHandle(handle, defaultHandle)
    ? {
        solana: env.SOLANA_WALLET || env.VITE_SOLANA_WALLET || '',
        evm: env.EVM_WALLET || env.VITE_EVM_WALLET || '',
      }
    : { solana: '', evm: '' };
  const known = knownWallets(handle);
  const solanaWallet = url.searchParams.get('solana') || envWallets.solana || known.solana;
  const evmWallet = url.searchParams.get('evm') || envWallets.evm || known.evm;
  const apiKey =
    header(req, 'x-fomo-api-key') || env.FOMO_API_KEY || env.VITE_FOMO_API_KEY || '';

  if (!handle && !solanaWallet) {
    send(res, 400, {
      error: 'config',
      message:
        'Set a FOMO handle and/or a Solana wallet in Settings, or FOMO_HANDLE / SOLANA_WALLET in .env',
    });
    return;
  }

  try {
    const snapshot = await loadPortfolio({
      handle,
      apiKey,
      solanaWallet,
      evmWallet,
      solanaRpcUrl: env.SOLANA_RPC_URL,
      heliusApiKey: env.HELIUS_API_KEY,
    });
    send(res, 200, snapshot);
  } catch (err) {
    send(res, 502, {
      error: 'upstream',
      message: err instanceof Error ? err.message : 'Failed to load portfolio',
    });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    await chatHandler(
      { method: req.method, headers: req.headers as Record<string, string | string[] | undefined>, body },
      {
        setHeader: (k, v) => {
          res.setHeader(k, v);
        },
        status: (code: number) => ({
          json: (payload: unknown) => send(res, code, payload),
          end: () => {
            res.statusCode = code;
            res.end();
          },
        }),
      },
    );
  } catch (err) {
    send(res, 400, {
      error: 'config',
      message: err instanceof Error ? err.message : 'Invalid chat body',
    });
  }
}

function onRequest(env: Record<string, string>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path === '/api/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (path === '/api/defaults') {
      const handle = env.FOMO_HANDLE || env.VITE_FOMO_HANDLE || '';
      const known = knownWallets(handle);
      send(res, 200, {
        handle,
        hasApiKey: Boolean(env.FOMO_API_KEY || env.VITE_FOMO_API_KEY),
        hasLlmKey: Boolean(env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY),
        solanaWallet: env.SOLANA_WALLET || env.VITE_SOLANA_WALLET || known.solana,
        evmWallet: env.EVM_WALLET || env.VITE_EVM_WALLET || known.evm,
      });
      return;
    }
    if (path === '/api/portfolio' && (req.method === 'GET' || req.method === 'POST')) {
      void handlePortfolio(req, res, env);
      return;
    }
    if (path === '/api/chat') {
      void handleChat(req, res);
      return;
    }
    next();
  };
}

export function portfolioApiPlugin(): Plugin {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  return {
    name: 'portfolio-api',
    configResolved(config) {
      Object.assign(env, config.env);
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(onRequest(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(onRequest(env));
    },
  };
}
