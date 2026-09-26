const RPC_URLS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const DRIP_TTL_MS = 10 * 60_000;

export type Acquisition = 'drip' | 'mixed' | 'trade';

export interface DripStats {
  mint: string;
  kind: Acquisition;
  receipts: number;
  receivedAmount: number;
  buys: number;
  boughtAmount: number;
  sells: number;
  soldAmount: number;
  /** Span covered by the sampled history, in days. */
  windowDays: number;
  payers: string[];
}

interface TokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}

interface ParsedTx {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
}

export type TxClass = 'receipt' | 'buy' | 'sell' | 'out' | 'none';

/** Classify one transaction from the owner's point of view for a single mint. */
export function classifyTx(tx: ParsedTx, owner: string, mint: string): { kind: TxClass; amount: number; payer: string; recipients: number } {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const payer = keys[0] || '';
  const meta = tx.meta;
  if (!meta || meta.err) return { kind: 'none', amount: 0, payer, recipients: 0 };
  const deltas = new Map<string, number>();
  const note = (rows: TokenBalance[] | undefined, sign: number) => {
    for (const b of rows ?? []) {
      const k = `${b.mint}|${b.owner ?? ''}`;
      deltas.set(k, (deltas.get(k) ?? 0) + sign * Number(b.uiTokenAmount.uiAmount ?? 0));
    }
  };
  note(meta.preTokenBalances, -1);
  note(meta.postTokenBalances, 1);

  let mine = 0;
  let spentOther = false;
  let gainedOther = false;
  let recipients = 0;
  for (const [k, d] of deltas) {
    const [m, o] = k.split('|');
    if (m === mint && d > 1e-12) recipients += 1;
    if (o !== owner || Math.abs(d) < 1e-12) continue;
    if (m === mint) mine += d;
    else if (d < 0) spentOther = true;
    else gainedOther = true;
  }
  const i = keys.indexOf(owner);
  if (i >= 0) {
    const lamports = (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0);
    if (lamports < -100_000) spentOther = true;
    if (lamports > 100_000) gainedOther = true;
  }
  if (mine > 0) return { kind: spentOther ? 'buy' : 'receipt', amount: mine, payer, recipients };
  if (mine < 0) return { kind: gainedOther ? 'sell' : 'out', amount: -mine, payer, recipients };
  return { kind: 'none', amount: 0, payer, recipients };
}

export function summarize(mint: string, rows: { cls: ReturnType<typeof classifyTx>; at?: number | null }[]): DripStats {
  const stats: DripStats = {
    mint,
    kind: 'trade',
    receipts: 0,
    receivedAmount: 0,
    buys: 0,
    boughtAmount: 0,
    sells: 0,
    soldAmount: 0,
    windowDays: 0,
    payers: [],
  };
  const payers = new Map<string, number>();
  let oldest = Infinity;
  for (const { cls, at } of rows) {
    if (at) oldest = Math.min(oldest, at * 1000);
    if (cls.kind === 'receipt') {
      stats.receipts += 1;
      stats.receivedAmount += cls.amount;
      payers.set(cls.payer, (payers.get(cls.payer) ?? 0) + 1);
    } else if (cls.kind === 'buy') {
      stats.buys += 1;
      stats.boughtAmount += cls.amount;
    } else if (cls.kind === 'sell' || cls.kind === 'out') {
      stats.sells += 1;
      stats.soldAmount += cls.amount;
    }
  }
  stats.windowDays = Number.isFinite(oldest) ? Math.max(1 / 24, (Date.now() - oldest) / 86_400_000) : 0;
  stats.payers = [...payers.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 5);
  if (stats.receipts >= 2) stats.kind = stats.buys > 0 ? 'mixed' : 'drip';
  return stats;
}

async function rpcBatch<T>(calls: { method: string; params: unknown[] }[], fetchFn: typeof fetch): Promise<(T | null)[]> {
  const body = JSON.stringify(calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params })));
  let lastErr: unknown;
  for (const url of RPC_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429) {
          lastErr = new Error('RPC 429');
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`RPC ${res.status}`);
        const rows = (await res.json()) as { id: number; result?: T }[];
        const out: (T | null)[] = calls.map(() => null);
        for (const r of Array.isArray(rows) ? rows : []) out[r.id] = r.result ?? null;
        return out;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Solana RPC batch failed');
}

const cache = new Map<string, { at: number; stats: DripStats }>();

async function analyzeMint(owner: string, mint: string, fetchFn: typeof fetch, sigLimit: number): Promise<DripStats> {
  const key = `${owner}:${mint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DRIP_TTL_MS) return hit.stats;

  const [accts] = await rpcBatch<{ value: { pubkey: string; account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>(
    [{ method: 'getTokenAccountsByOwner', params: [owner, { mint }, { encoding: 'jsonParsed' }] }],
    fetchFn,
  );
  const account = [...(accts?.value ?? [])].sort(
    (a, b) =>
      Number(b.account.data.parsed.info.tokenAmount.uiAmount ?? 0) -
      Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
  )[0]?.pubkey;
  if (!account) return summarize(mint, []);

  const [sigs] = await rpcBatch<{ signature: string; blockTime?: number | null }[]>(
    [{ method: 'getSignaturesForAddress', params: [account, { limit: sigLimit }] }],
    fetchFn,
  );
  const rows: { cls: ReturnType<typeof classifyTx>; at?: number | null }[] = [];
  const list = sigs ?? [];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const txs = await rpcBatch<ParsedTx>(
      chunk.map((s) => ({
        method: 'getTransaction',
        params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      })),
      fetchFn,
    );
    txs.forEach((tx, j) => {
      if (tx) rows.push({ cls: classifyTx(tx, owner, mint), at: tx.blockTime ?? chunk[j].blockTime });
    });
  }
  const stats = summarize(mint, rows);
  cache.set(key, { at: Date.now(), stats });
  return stats;
}

/** Sample recent history for a few Solana mints and tell drip income apart from trades. */
export async function analyzeDrips(
  owner: string,
  mints: string[],
  fetchFn: typeof fetch = fetch,
  sigLimit = 25,
): Promise<Map<string, DripStats>> {
  const out = new Map<string, DripStats>();
  const queue = [...new Set(mints)];
  const failed: string[] = [];
  // Two at a time keeps public RPC rate limits happy while halving wall time.
  const worker = async () => {
    for (let mint = queue.shift(); mint; mint = queue.shift()) {
      try {
        out.set(mint, await analyzeMint(owner, mint, fetchFn, sigLimit));
      } catch {
        failed.push(mint);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  for (const mint of failed) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      out.set(mint, await analyzeMint(owner, mint, fetchFn, sigLimit));
    } catch {
      // drip tags are best-effort
    }
  }
  return out;
}
