export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const MAX_SLIPPAGE_BPS = 500;
export const MAX_IMPACT_PCT = 3;
const MIN_SLIPPAGE_BPS = 100;

export interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  [k: string]: unknown;
}

export interface JupiterEnv {
  JUPITER_API_URL?: string;
  JUPITER_API_KEY?: string;
}

function base(env: JupiterEnv): string {
  return (env.JUPITER_API_URL || (env.JUPITER_API_KEY ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1')).replace(/\/$/, '');
}

function headers(env: JupiterEnv): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : {}),
  };
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: (T & { error?: string; errorCode?: string }) | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // fall through
  }
  if (!res.ok || !body) throw new Error(`Jupiter ${what} ${res.status}: ${body?.error || text.slice(0, 160)}`);
  return body;
}

export async function quoteExactIn(
  input: { inputMint: string; outputMint: string; amount: string; slippageBps: number },
  env: JupiterEnv,
  fetchFn: typeof fetch = fetch,
): Promise<JupiterQuote> {
  const q = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    slippageBps: String(input.slippageBps),
    swapMode: 'ExactIn',
  });
  const res = await fetchFn(`${base(env)}/quote?${q}`, { headers: headers(env), signal: AbortSignal.timeout(10_000) });
  return readJson<JupiterQuote>(res, 'quote');
}

export function impactPct(quote: JupiterQuote): number {
  return Math.abs(Number(quote.priceImpactPct) || 0) * 100;
}

interface SwapBody {
  swapTransaction: string;
  lastValidBlockHeight: number;
  dynamicSlippageReport?: { slippageBps?: number | null } | null;
  simulationError?: { error?: string } | null;
}

/**
 * Builds (never signs) a swap with dynamic slippage uncapped, only to read how much slippage the route needs.
 * The transaction it returns is thrown away.
 */
export async function requiredSlippageBps(
  quote: JupiterQuote,
  user: string,
  env: JupiterEnv,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchFn(`${base(env)}/swap`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user,
      dynamicSlippage: { maxBps: 10_000 },
      dynamicComputeUnitLimit: true,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await readJson<SwapBody>(res, 'swap probe');
  const bps = body.dynamicSlippageReport?.slippageBps;
  return typeof bps === 'number' && bps > 0 ? bps : quote.slippageBps;
}

export function executionSlippageBps(required: number): number {
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.ceil(required)));
}

/** Swap transaction at the quote's fixed slippage; dynamic slippage stays off so it can never widen. */
export async function buildSwap(
  quote: JupiterQuote,
  user: string,
  env: JupiterEnv,
  fetchFn: typeof fetch = fetch,
): Promise<SwapBody> {
  const res = await fetchFn(`${base(env)}/swap`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: user,
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: 'high' } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return readJson<SwapBody>(res, 'swap');
}

export async function usdPrices(mints: string[], fetchFn: typeof fetch = fetch): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < mints.length; i += 50) {
    const ids = mints.slice(i, i + 50).join(',');
    const res = await fetchFn(`https://lite-api.jup.ag/price/v3?ids=${ids}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) continue;
    const body = (await res.json()) as Record<string, { usdPrice?: number } | null>;
    for (const [mint, row] of Object.entries(body)) if (row?.usdPrice) out.set(mint, row.usdPrice);
  }
  return out;
}
