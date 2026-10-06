import { randomUUID } from 'node:crypto';
import { MAX_RUNNER_AGE_HOURS, bookSizeCap, bookVetoes, floorsFor, isExtended } from '../scanner/rules.ts';
import type { TapeRow } from '../../types/plays.ts';
import type { AgentIntent, AgentState, IntentBook, IntentRequest } from '../../types/agent.ts';
import { sendTransaction, waitForSignature, walletBalances, walletEquity, type WalletBalances } from './chain.ts';
import {
  MAX_IMPACT_PCT,
  MAX_SLIPPAGE_BPS,
  USDC_MINT,
  buildSwap,
  executionSlippageBps,
  impactPct,
  quoteExactIn,
  requiredSlippageBps,
  type JupiterEnv,
  type JupiterQuote,
} from './jupiter.ts';
import type { AgentSigner } from './keys.ts';
import { signSwapTransaction } from './tx.ts';
import type { AgentStore, IntentRow, PositionRow, WalletRow } from './store.ts';

export const AGENT_HANDLES = ['softmereelk', 'busymeredog'];
export const NAME_PCT = 15;
export const MIN_SIZE_USD = 25;
export const PENDING_SECONDS = 90;
const ATTEMPTS = 2;
const LAND_WAIT_MS = 22_000;

export interface AgentDeps {
  store: AgentStore;
  signer: AgentSigner;
  rpcUrl: string;
  env: JupiterEnv & { AGENT_WITHDRAW?: string };
  tape: () => Promise<{ rows: TapeRow[]; fetchedAt: number }>;
  fetchFn?: typeof fetch;
}

export class AgentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function signedPct(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`;
}

export function publicIntent(row: IntentRow): AgentIntent {
  const { playSnapshot: _snap, ...rest } = row;
  return rest;
}

/** Same CHASE test as the board: 1h over +80% or 1h volume over 8x liquidity. */
export function chaseReason(row: TapeRow): string | null {
  if (!isExtended(row)) return null;
  if ((row.change1hPct ?? 0) > 80) return `CHASE: 1h ${signedPct(row.change1hPct!)} is past +80%`;
  const turnover = row.liquidityUsd > 0 ? row.volume1hUsd / row.liquidityUsd : Infinity;
  return `CHASE: 1h volume ${Number.isFinite(turnover) ? turnover.toFixed(1) : '∞'}x liquidity is past 8x`;
}

/** Every pre-quote rule for a buy. Empty means the intent may be quoted. */
export function buyRejections(input: {
  handle: string;
  mint: string;
  row: TapeRow | undefined;
  book: IntentBook | null | undefined;
  held: PositionRow | null;
}): string[] {
  const out: string[] = [];
  const row = input.row;
  if (!row) return ['mint is not on the current tape'];
  if (row.chain !== 'solana') out.push('the agent wallet only trades Solana');
  if (row.ageHours == null) out.push('launch age unknown');
  else if (row.ageHours > MAX_RUNNER_AGE_HOURS) out.push(`launched ${Math.round(row.ageHours)}h ago, past 48h`);
  const chase = chaseReason(row);
  if (chase) out.push(chase);
  if (!input.book) out.push('book not loaded on the page');
  else out.push(...bookVetoes(input.book).map((v) => `book veto: ${v}`));
  const floor = floorsFor(input.handle, input.book?.equity ?? 0).minLiq;
  if (row.liquidityUsd < floor) out.push(`liquidity ${usd(row.liquidityUsd)} under the ${usd(floor)} watch floor`);
  if (input.held) out.push(`agent already holds ${input.held.symbol || input.mint.slice(0, 4)}`);
  return out;
}

/** min(15% of agent equity, room under cap_usd, play size cap), rounded down to $10. */
export function agentSize(input: { equityUsd: number; capUsd: number; deployedUsd: number; playCapUsd: number }): {
  sizeUsd: number;
  why: string;
} {
  const nameCap = (input.equityUsd * NAME_PCT) / 100;
  const room = Math.max(0, input.capUsd - input.deployedUsd);
  const raw = Math.min(nameCap, room, input.playCapUsd);
  const sizeUsd = Math.max(0, Math.floor(raw / 10) * 10);
  const why = `15% of agent equity ${usd(nameCap)}, room under cap ${usd(room)}, play cap ${usd(input.playCapUsd)}`;
  return { sizeUsd, why };
}

async function bootWallet(deps: AgentDeps): Promise<WalletRow> {
  return deps.store.bootWallet(deps.signer.address, deps.env.AGENT_WITHDRAW?.trim() || null);
}

async function balancesOf(deps: AgentDeps, address: string): Promise<WalletBalances & { equityUsd: number }> {
  const balances = await walletBalances(deps.rpcUrl, address, deps.fetchFn);
  const { equityUsd } = await walletEquity(balances, deps.fetchFn);
  return { ...balances, equityUsd };
}

function deployed(positions: PositionRow[]): number {
  return positions.reduce((a, p) => a + p.costUsd, 0);
}

export async function stageIntent(deps: AgentDeps, body: IntentRequest): Promise<AgentIntent> {
  const handle = (body.handle || '').replace(/^@/, '').trim();
  const mint = (body.mint || '').trim();
  const side = body.side;
  if (!AGENT_HANDLES.includes(handle.toLowerCase())) throw new AgentError(400, 'handle must be SoftMereElk or BusyMereDog');
  if (!mint) throw new AgentError(400, 'mint is required');
  if (side !== 'buy' && side !== 'sell') throw new AgentError(400, "side must be 'buy' or 'sell'");
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

  const wallet = await bootWallet(deps);
  const [tape, held, positions] = await Promise.all([deps.tape(), deps.store.position(mint), deps.store.positions()]);
  const row = tape.rows.find((r) => r.mint === mint);
  const snapshot: Record<string, unknown> = {
    tapeAt: new Date(tape.fetchedAt).toISOString(),
    onTape: Boolean(row),
    row: row ?? null,
    book: body.book ?? null,
  };

  const write = (status: 'rejected' | 'pending', fields: Partial<Parameters<AgentStore['insertIntent']>[0]> = {}) =>
    deps.store
      .insertIntent({
        id: `int_${randomUUID()}`,
        handle,
        mint,
        symbol: row?.symbol ?? held?.symbol ?? null,
        side,
        status,
        reason,
        rejectReason: null,
        sizeUsd: null,
        quoteOut: null,
        priceImpactPct: null,
        playSnapshot: snapshot,
        expiresInSec: status === 'pending' ? PENDING_SECONDS : null,
        ...fields,
      })
      .then(publicIntent);

  let inputMint: string;
  let outputMint: string;
  let amount: string;
  let sizeUsd: number | null = null;

  if (side === 'buy') {
    const failures = buyRejections({ handle, mint, row, book: body.book, held });
    if (failures.length) return write('rejected', { rejectReason: failures.join('; ') });

    let bal: WalletBalances & { equityUsd: number };
    try {
      bal = await balancesOf(deps, wallet.address);
    } catch (err) {
      return write('rejected', { rejectReason: `agent balance unavailable: ${err instanceof Error ? err.message : err}` });
    }
    const playCapUsd = bookSizeCap(body.book!);
    const size = agentSize({ equityUsd: bal.equityUsd, capUsd: wallet.capUsd, deployedUsd: deployed(positions), playCapUsd });
    snapshot.sizing = { equityUsd: bal.equityUsd, usdc: bal.usdc, sol: bal.sol, capUsd: wallet.capUsd, playCapUsd, ...size };
    if (size.sizeUsd < MIN_SIZE_USD) {
      return write('rejected', { rejectReason: `size ${usd(size.sizeUsd)} under the $25 minimum (${size.why})` });
    }
    if (bal.usdc < size.sizeUsd) {
      return write('rejected', { rejectReason: `agent holds ${usd(bal.usdc)} USDC, under the ${usd(size.sizeUsd)} size` });
    }
    sizeUsd = size.sizeUsd;
    inputMint = USDC_MINT;
    outputMint = mint;
    amount = String(Math.round(size.sizeUsd * 1e6));
  } else {
    if (!held) return write('rejected', { rejectReason: 'agent holds no position in this mint' });
    inputMint = mint;
    outputMint = USDC_MINT;
    amount = held.qty;
  }

  let quote: JupiterQuote;
  let requiredBps: number;
  try {
    quote = await quoteExactIn({ inputMint, outputMint, amount, slippageBps: MAX_SLIPPAGE_BPS }, deps.env, deps.fetchFn);
    requiredBps = await requiredSlippageBps(quote, wallet.address, deps.env, deps.fetchFn);
  } catch (err) {
    return write('rejected', { rejectReason: `no Jupiter quote: ${err instanceof Error ? err.message : err}`, sizeUsd });
  }
  const impact = impactPct(quote);
  if (side === 'sell') sizeUsd = Number(quote.outAmount) / 1e6;
  const slippageBps = executionSlippageBps(requiredBps);
  snapshot.quote = { inputMint, outputMint, amount, outAmount: quote.outAmount, requiredBps, slippageBps };
  const quoted = { sizeUsd, quoteOut: quote.outAmount, priceImpactPct: impact };
  const quoteFails: string[] = [];
  if (impact > MAX_IMPACT_PCT) quoteFails.push(`Jupiter price impact ${impact.toFixed(2)}% over 3%`);
  if (requiredBps > MAX_SLIPPAGE_BPS) quoteFails.push(`route needs ${(requiredBps / 100).toFixed(1)}% slippage, over 5%`);
  if (quoteFails.length) return write('rejected', { ...quoted, rejectReason: quoteFails.join('; ') });
  return write('pending', quoted);
}

export async function confirmIntent(deps: AgentDeps, intentId: string): Promise<AgentIntent> {
  if (!intentId) throw new AgentError(400, 'intentId is required');
  const wallet = await bootWallet(deps);
  const intent = await deps.store.intent(intentId);
  if (!intent) throw new AgentError(404, 'no such intent');
  if (intent.status !== 'pending') throw new AgentError(409, `intent is ${intent.status}, not pending`);
  if (!intent.expiresAt || Date.parse(intent.expiresAt) <= Date.now()) {
    await deps.store.expirePending();
    throw new AgentError(409, 'intent expired');
  }
  const claimed = await deps.store.claimPending(intentId);
  if (!claimed) throw new AgentError(409, 'intent expired or already confirming');

  const q = intent.playSnapshot.quote as { inputMint: string; outputMint: string; amount: string; slippageBps: number };
  const errors: string[] = [];
  let sent: string | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const quote = await quoteExactIn(
        { inputMint: q.inputMint, outputMint: q.outputMint, amount: q.amount, slippageBps: q.slippageBps },
        deps.env,
        deps.fetchFn,
      );
      const impact = impactPct(quote);
      if (impact > MAX_IMPACT_PCT) throw new Error(`price impact ${impact.toFixed(2)}% over 3% at confirm`);
      const swap = await buildSwap(quote, wallet.address, deps.env, deps.fetchFn);
      const signed = signSwapTransaction(swap.swapTransaction, deps.signer);
      await sendTransaction(deps.rpcUrl, signed.signed, deps.fetchFn);
      const signature = signed.signature;
      sent = signature;
      const landed = await waitForSignature(deps.rpcUrl, signature, swap.lastValidBlockHeight, LAND_WAIT_MS, deps.fetchFn);
      if (landed.state === 'unknown') {
        await deps.store.finishIntent(intentId, {
          status: 'failed',
          signature,
          error: `sent ${signature} but not confirmed in ${LAND_WAIT_MS / 1000}s; not retried so it cannot fill twice`,
        });
        return publicIntent((await deps.store.intent(intentId))!);
      }
      if (landed.state === 'failed') throw new Error(landed.error);

      if (intent.side === 'buy') {
        const qty = await walletBalances(deps.rpcUrl, wallet.address, deps.fetchFn)
          .then((b) => b.tokens.find((t) => t.mint === intent.mint)?.raw)
          .catch(() => undefined);
        await deps.store.upsertBuy({
          mint: intent.mint,
          symbol: intent.symbol,
          qty: qty ?? quote.outAmount,
          costUsd: intent.sizeUsd ?? 0,
        });
      } else {
        await deps.store.closePosition(intent.mint);
      }
      await deps.store.finishIntent(intentId, { status: 'signed', signature, error: null });
      return publicIntent((await deps.store.intent(intentId))!);
    } catch (err) {
      errors.push(`attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt === ATTEMPTS) {
        await deps.store.finishIntent(intentId, { status: 'failed', signature: sent, error: errors.join(' | ') });
      }
    }
  }
  return publicIntent((await deps.store.intent(intentId))!);
}

let equityCache: { at: number; address: string; value: WalletBalances & { equityUsd: number } } | null = null;

export async function agentState(deps: AgentDeps): Promise<AgentState> {
  const wallet = await bootWallet(deps);
  await deps.store.expirePending();
  const [positions, intents] = await Promise.all([deps.store.positions(), deps.store.recentIntents(20)]);
  const warnings: string[] = [];
  let bal: (WalletBalances & { equityUsd: number }) | null = null;
  if (equityCache && equityCache.address === wallet.address && Date.now() - equityCache.at < 15_000) {
    bal = equityCache.value;
  } else {
    try {
      bal = await balancesOf(deps, wallet.address);
      equityCache = { at: Date.now(), address: wallet.address, value: bal };
    } catch (err) {
      warnings.push(`balance unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }
  const now = Date.now();
  return {
    address: wallet.address,
    capUsd: wallet.capUsd,
    equityUsd: bal?.equityUsd ?? null,
    usdc: bal?.usdc ?? null,
    sol: bal?.sol ?? null,
    deployedUsd: deployed(positions),
    withdrawAddress: wallet.withdrawAddress,
    positions,
    intents: intents.map(publicIntent),
    pendingCount: intents.filter((i) => i.status === 'pending' && i.expiresAt && Date.parse(i.expiresAt) > now).length,
    warnings,
  };
}
