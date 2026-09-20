import { loadPortfolio } from '../src/lib/portfolio/load.ts';

export const config = {
  maxDuration: 60,
};

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default async function handler(
  req: { method?: string; query: Query; headers: Query },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (k: string, v: string) => void;
  },
) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const handle = first(req.query.handle) || process.env.FOMO_HANDLE || process.env.VITE_FOMO_HANDLE || '';
  const solanaWallet =
    first(req.query.solana) || process.env.SOLANA_WALLET || process.env.VITE_SOLANA_WALLET || '';
  const evmWallet = first(req.query.evm) || process.env.EVM_WALLET || process.env.VITE_EVM_WALLET || '';
  const apiKey =
    first(req.headers['x-fomo-api-key']) || process.env.FOMO_API_KEY || process.env.VITE_FOMO_API_KEY || '';

  if (!handle && !solanaWallet) {
    res.status(400).json({
      error: 'config',
      message:
        'Set a FOMO handle and/or a Solana wallet in Settings, or FOMO_HANDLE / SOLANA_WALLET in the environment.',
    });
    return;
  }

  try {
    const snapshot = await loadPortfolio({
      handle,
      apiKey,
      solanaWallet,
      evmWallet,
      solanaRpcUrl: process.env.SOLANA_RPC_URL,
      heliusApiKey: process.env.HELIUS_API_KEY,
    });
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(snapshot);
  } catch (err) {
    res.status(502).json({
      error: 'upstream',
      message: err instanceof Error ? err.message : 'Failed to load portfolio',
    });
  }
}
