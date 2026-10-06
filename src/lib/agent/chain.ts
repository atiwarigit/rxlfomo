import { SOL_MINT, USDC_MINT, usdPrices } from './jupiter.ts';

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];

/** publicnode refuses getTokenAccountsByOwner without a token, so it is only the fallback. */
export function rpcUrls(env: { SOLANA_RPC_URL?: string; HELIUS_API_KEY?: string }): string[] {
  if (env.SOLANA_RPC_URL) return [env.SOLANA_RPC_URL];
  if (env.HELIUS_API_KEY) return [`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`];
  return ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
}

export async function rpc<T>(urls: string[], method: string, params: unknown[], fetchFn: typeof fetch = fetch): Promise<T> {
  let last: unknown = new Error('no Solana RPC');
  for (const url of urls) {
    try {
      return await rpcOnce<T>(url, method, params, fetchFn);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function rpcOnce<T>(url: string, method: string, params: unknown[], fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: T;
    error?: { message?: string; data?: { err?: unknown; logs?: string[] } };
  };
  if (body.error) {
    const err = body.error.data?.err;
    const log = body.error.data?.logs?.filter((l) => /error|failed|insufficient/i.test(l)).slice(-1)[0];
    const detail = [err != null ? JSON.stringify(err) : '', log || ''].filter(Boolean).join(' — ');
    throw new Error(`${body.error.message || `${method} failed`}${detail ? `: ${detail}` : ''}`);
  }
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  return body.result as T;
}

export interface TokenBalance {
  mint: string;
  raw: string;
  ui: number;
}

export interface WalletBalances {
  sol: number;
  usdc: number;
  tokens: TokenBalance[];
}

interface ParsedAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; uiAmount: number | null } } } } };
}

export async function walletBalances(urls: string[], owner: string, fetchFn: typeof fetch = fetch): Promise<WalletBalances> {
  const [lamports, ...programs] = await Promise.all([
    rpc<{ value: number }>(urls, 'getBalance', [owner, { commitment: 'confirmed' }], fetchFn),
    ...TOKEN_PROGRAMS.map((programId) =>
      rpc<{ value: ParsedAccount[] }>(urls,
        'getTokenAccountsByOwner',
        [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        fetchFn,
      ),
    ),
  ]);
  const byMint = new Map<string, TokenBalance>();
  for (const program of programs) {
    for (const acc of program.value) {
      const info = acc.account.data.parsed.info;
      const prev = byMint.get(info.mint);
      const raw = (BigInt(prev?.raw ?? '0') + BigInt(info.tokenAmount.amount)).toString();
      byMint.set(info.mint, { mint: info.mint, raw, ui: (prev?.ui ?? 0) + (info.tokenAmount.uiAmount ?? 0) });
    }
  }
  const tokens = [...byMint.values()].filter((t) => t.raw !== '0');
  return {
    sol: lamports.value / 1e9,
    usdc: byMint.get(USDC_MINT)?.ui ?? 0,
    tokens,
  };
}

/** Agent equity in USD: USDC + SOL (fee buffer included) + every other token at Jupiter's price. */
export async function walletEquity(
  balances: WalletBalances,
  fetchFn: typeof fetch = fetch,
): Promise<{ equityUsd: number; prices: Map<string, number> }> {
  const others = balances.tokens.filter((t) => t.mint !== USDC_MINT).map((t) => t.mint);
  const prices = await usdPrices([SOL_MINT, ...others], fetchFn).catch(() => new Map<string, number>());
  let equityUsd = balances.usdc + balances.sol * (prices.get(SOL_MINT) ?? 0);
  for (const t of balances.tokens) {
    if (t.mint === USDC_MINT || t.mint === SOL_MINT) continue;
    equityUsd += t.ui * (prices.get(t.mint) ?? 0);
  }
  return { equityUsd, prices };
}

export async function sendTransaction(urls: string[], base64: string, fetchFn: typeof fetch = fetch): Promise<string> {
  return rpc<string>(urls,
    'sendTransaction',
    [base64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }],
    fetchFn,
  );
}

export type Landed = { state: 'confirmed' } | { state: 'failed'; error: string } | { state: 'unknown' };

/** Waits for one signature until confirmed, failed on chain, or the blockhash expires / the wait runs out. */
export async function waitForSignature(
  urls: string[],
  signature: string,
  lastValidBlockHeight: number,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<Landed> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const st = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(urls,
      'getSignatureStatuses',
      [[signature]],
      fetchFn,
    ).catch(() => null);
    const s = st?.value?.[0];
    if (s?.err) return { state: 'failed', error: `on-chain error ${JSON.stringify(s.err)}` };
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return { state: 'confirmed' };
    const height = await rpc<number>(urls, 'getBlockHeight', [{ commitment: 'confirmed' }], fetchFn).catch(() => 0);
    if (!s && height > lastValidBlockHeight) return { state: 'failed', error: 'blockhash expired before the swap landed' };
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return { state: 'unknown' };
}
