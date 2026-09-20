import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { loadPortfolio } from '../src/lib/portfolio/load.ts';

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
  const handle =
    url.searchParams.get('handle') || env.FOMO_HANDLE || env.VITE_FOMO_HANDLE || '';
  const solanaWallet =
    url.searchParams.get('solana') ||
    env.SOLANA_WALLET ||
    env.VITE_SOLANA_WALLET ||
    '';
  const evmWallet =
    url.searchParams.get('evm') || env.EVM_WALLET || env.VITE_EVM_WALLET || '';
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

function onRequest(env: Record<string, string>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path === '/api/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (path === '/api/defaults') {
      const handle = env.FOMO_HANDLE || env.VITE_FOMO_HANDLE || '';
      send(res, 200, {
        handle,
        hasApiKey: Boolean(env.FOMO_API_KEY || env.VITE_FOMO_API_KEY),
        solanaWallet: env.SOLANA_WALLET || env.VITE_SOLANA_WALLET || '',
        evmWallet: env.EVM_WALLET || env.VITE_EVM_WALLET || '',
      });
      return;
    }
    if (path === '/api/portfolio' && (req.method === 'GET' || req.method === 'POST')) {
      void handlePortfolio(req, res, env);
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
