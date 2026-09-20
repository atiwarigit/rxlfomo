const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL = 'So11111111111111111111111111111111111111112';
const DEFAULT_RPC = 'https://solana-rpc.publicnode.com';

export interface OnchainHolding {
  mint: string;
  amount: number;
  decimals: number;
  symbol?: string;
  name?: string;
  priceUsd?: number;
  valueUsd?: number;
  chain: 'solana';
  native?: boolean;
}

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
  fetchFn: typeof fetch,
): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as RpcResponse<T>;
  if (body.error) throw new Error(body.error.message || 'Solana RPC error');
  return body.result as T;
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: { uiAmount: number | null; decimals: number };
        };
      };
    };
  };
}

async function tokenAccounts(
  rpcUrl: string,
  owner: string,
  programId: string,
  fetchFn: typeof fetch,
): Promise<OnchainHolding[]> {
  const result = await rpc<{ value: ParsedTokenAccount[] }>(
    rpcUrl,
    'getTokenAccountsByOwner',
    [owner, { programId }, { encoding: 'jsonParsed' }],
    fetchFn,
  );
  return (result.value ?? [])
    .map((row) => {
      const info = row.account.data.parsed.info;
      return {
        mint: info.mint,
        amount: Number(info.tokenAmount.uiAmount ?? 0),
        decimals: info.tokenAmount.decimals,
        chain: 'solana' as const,
      };
    })
    .filter((h) => h.amount > 0);
}

interface HeliusAsset {
  id?: string;
  content?: { metadata?: { symbol?: string; name?: string } };
  token_info?: {
    symbol?: string;
    balance?: number;
    decimals?: number;
    price_info?: { price_per_token?: number; total_price?: number };
  };
}

interface HeliusAssets {
  nativeBalance?: { lamports?: number; price_per_sol?: number };
  items?: HeliusAsset[];
}

export async function fetchSolanaHoldings(opts: {
  owner: string;
  rpcUrl?: string;
  heliusApiKey?: string;
  fetchFn?: typeof fetch;
}): Promise<OnchainHolding[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  if (opts.heliusApiKey) {
    try {
      return await fetchHeliusHoldings(opts.owner, opts.heliusApiKey, fetchFn);
    } catch {
      // fall through to public RPC
    }
  }
  const rpcUrl = opts.rpcUrl || DEFAULT_RPC;
  const [lamports, spl, t22] = await Promise.all([
    rpc<{ value: number }>(rpcUrl, 'getBalance', [opts.owner], fetchFn),
    tokenAccounts(rpcUrl, opts.owner, TOKEN_PROGRAM, fetchFn),
    tokenAccounts(rpcUrl, opts.owner, TOKEN_2022_PROGRAM, fetchFn).catch(
      () => [] as OnchainHolding[],
    ),
  ]);
  const native: OnchainHolding = {
    mint: WSOL,
    amount: lamports.value / 1_000_000_000,
    decimals: 9,
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    native: true,
  };
  const tokens = [...spl, ...t22].filter((h) => h.mint !== WSOL);
  return native.amount > 0 ? [native, ...tokens] : tokens;
}

async function fetchHeliusHoldings(
  owner: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<OnchainHolding[]> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: owner,
        page: 1,
        limit: 1000,
        displayOptions: { showFungible: true, showNativeBalance: true },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as RpcResponse<HeliusAssets>;
  if (body.error) throw new Error(body.error.message || 'Helius error');
  const data = body.result ?? {};
  const out: OnchainHolding[] = [];
  const lamports = data.nativeBalance?.lamports ?? 0;
  if (lamports > 0) {
    out.push({
      mint: WSOL,
      amount: lamports / 1_000_000_000,
      decimals: 9,
      symbol: 'SOL',
      name: 'Solana',
      priceUsd: data.nativeBalance?.price_per_sol,
      valueUsd:
        data.nativeBalance?.price_per_sol != null
          ? (lamports / 1_000_000_000) * data.nativeBalance.price_per_sol
          : undefined,
      chain: 'solana',
      native: true,
    });
  }
  for (const item of data.items ?? []) {
    const info = item.token_info;
    if (!info || !item.id) continue;
    const decimals = info.decimals ?? 0;
    const raw = Number(info.balance ?? 0);
    const amount = decimals >= 0 ? raw / 10 ** decimals : raw;
    if (amount <= 0) continue;
    const price = info.price_info?.price_per_token;
    out.push({
      mint: item.id,
      amount,
      decimals,
      symbol: info.symbol || item.content?.metadata?.symbol,
      name: item.content?.metadata?.name,
      priceUsd: price,
      valueUsd: info.price_info?.total_price ?? (price != null ? amount * price : undefined),
      chain: 'solana',
    });
  }
  return out;
}
