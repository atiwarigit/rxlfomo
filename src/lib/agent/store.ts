import pg from 'pg';
import { CONFIRMING } from '../../types/agent.ts';

export const SCHEMA_SQL = `
create table if not exists agent_wallet (
  id text primary key,
  address text not null unique,
  chain text not null default 'solana',
  cap_usd numeric not null default 500,
  withdraw_address text,
  created_at timestamptz not null default now()
);

create table if not exists agent_intent (
  id text primary key,
  handle text not null,
  mint text not null,
  symbol text,
  side text not null check (side in ('buy', 'sell')),
  status text not null check (status in ('rejected', 'pending', 'expired', 'signed', 'failed')),
  reason text,
  reject_reason text,
  size_usd numeric,
  quote_out text,
  price_impact_pct numeric,
  play_snapshot jsonb not null,
  expires_at timestamptz,
  confirmed_at timestamptz,
  signature text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists agent_intent_created_at_idx on agent_intent (created_at desc);

create table if not exists agent_position (
  mint text primary key,
  symbol text,
  qty text not null,
  cost_usd numeric not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

export const WALLET_ID = 'agent';

export type IntentStatus = 'rejected' | 'pending' | 'expired' | 'signed' | 'failed';

export interface WalletRow {
  id: string;
  address: string;
  chain: string;
  capUsd: number;
  withdrawAddress: string | null;
  createdAt: string;
}

export interface IntentRow {
  id: string;
  handle: string;
  mint: string;
  symbol: string | null;
  side: 'buy' | 'sell';
  status: IntentStatus;
  reason: string | null;
  rejectReason: string | null;
  sizeUsd: number | null;
  quoteOut: string | null;
  priceImpactPct: number | null;
  playSnapshot: Record<string, unknown>;
  expiresAt: string | null;
  confirmedAt: string | null;
  signature: string | null;
  error: string | null;
  createdAt: string;
}

export interface PositionRow {
  mint: string;
  symbol: string | null;
  qty: string;
  costUsd: number;
  openedAt: string;
  updatedAt: string;
}

export interface NewIntent {
  id: string;
  handle: string;
  mint: string;
  symbol: string | null;
  side: 'buy' | 'sell';
  status: 'rejected' | 'pending';
  reason: string | null;
  rejectReason: string | null;
  sizeUsd: number | null;
  quoteOut: string | null;
  priceImpactPct: number | null;
  playSnapshot: Record<string, unknown>;
  expiresInSec: number | null;
}

export interface AgentStore {
  bootWallet(address: string, withdrawAddress: string | null): Promise<WalletRow>;
  positions(): Promise<PositionRow[]>;
  position(mint: string): Promise<PositionRow | null>;
  insertIntent(row: NewIntent): Promise<IntentRow>;
  intent(id: string): Promise<IntentRow | null>;
  recentIntents(limit: number): Promise<IntentRow[]>;
  expirePending(): Promise<void>;
  /** Moves a pending, unexpired intent to `signed`/`failed` exactly once; null when another call already claimed it. */
  claimPending(id: string): Promise<IntentRow | null>;
  finishIntent(id: string, patch: { status: 'signed' | 'failed'; signature?: string | null; error?: string | null }): Promise<void>;
  upsertBuy(input: { mint: string; symbol: string | null; qty: string; costUsd: number }): Promise<void>;
  closePosition(mint: string): Promise<void>;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function walletRow(r: Record<string, unknown>): WalletRow {
  return {
    id: r.id as string,
    address: r.address as string,
    chain: r.chain as string,
    capUsd: Number(r.cap_usd),
    withdrawAddress: (r.withdraw_address as string) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

function intentRow(r: Record<string, unknown>): IntentRow {
  return {
    id: r.id as string,
    handle: r.handle as string,
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? null,
    side: r.side as 'buy' | 'sell',
    status: r.status as IntentStatus,
    reason: (r.reason as string) ?? null,
    rejectReason: (r.reject_reason as string) ?? null,
    sizeUsd: num(r.size_usd),
    quoteOut: (r.quote_out as string) ?? null,
    priceImpactPct: num(r.price_impact_pct),
    playSnapshot: r.play_snapshot as Record<string, unknown>,
    expiresAt: iso(r.expires_at),
    confirmedAt: iso(r.confirmed_at),
    signature: (r.signature as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

function positionRow(r: Record<string, unknown>): PositionRow {
  return {
    mint: r.mint as string,
    symbol: (r.symbol as string) ?? null,
    qty: r.qty as string,
    costUsd: Number(r.cost_usd),
    openedAt: iso(r.opened_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

let pool: pg.Pool | null = null;
let poolUrl = '';
let schemaReady: Promise<void> | null = null;

export function databaseUrl(env: { DATABASE_URL?: string; POSTGRES_URL?: string }): string {
  return env.DATABASE_URL || env.POSTGRES_URL || '';
}

export function pgStore(url: string): AgentStore {
  if (!pool || poolUrl !== url) {
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
    poolUrl = url;
    schemaReady = null;
  }
  const db = pool;
  const ready = () => (schemaReady ??= db.query(SCHEMA_SQL).then(() => undefined));
  const q = async (text: string, values: unknown[] = []) => {
    await ready();
    return (await db.query(text, values)).rows as Record<string, unknown>[];
  };

  return {
    async bootWallet(address, withdrawAddress) {
      await q(
        `insert into agent_wallet (id, address, withdraw_address) values ($1, $2, $3) on conflict (id) do nothing`,
        [WALLET_ID, address, withdrawAddress],
      );
      const rows = await q(
        `update agent_wallet set withdraw_address = coalesce($2, withdraw_address) where id = $1 returning *`,
        [WALLET_ID, withdrawAddress],
      );
      const row = walletRow(rows[0]);
      if (row.address !== address) {
        throw new Error(`agent_wallet holds ${row.address}; AGENT_SIGNER is ${address}. One agent wallet only.`);
      }
      return row;
    },
    async positions() {
      return (await q(`select * from agent_position order by opened_at`)).map(positionRow);
    },
    async position(mint) {
      const rows = await q(`select * from agent_position where mint = $1`, [mint]);
      return rows[0] ? positionRow(rows[0]) : null;
    },
    async insertIntent(row) {
      const rows = await q(
        `insert into agent_intent
          (id, handle, mint, symbol, side, status, reason, reject_reason, size_usd, quote_out, price_impact_pct, play_snapshot, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           case when $13::int is null then null else now() + make_interval(secs => $13::int) end)
         returning *`,
        [
          row.id,
          row.handle,
          row.mint,
          row.symbol,
          row.side,
          row.status,
          row.reason,
          row.rejectReason,
          row.sizeUsd,
          row.quoteOut,
          row.priceImpactPct,
          JSON.stringify(row.playSnapshot),
          row.expiresInSec,
        ],
      );
      return intentRow(rows[0]);
    },
    async intent(id) {
      const rows = await q(`select * from agent_intent where id = $1`, [id]);
      return rows[0] ? intentRow(rows[0]) : null;
    },
    async recentIntents(limit) {
      return (await q(`select * from agent_intent order by created_at desc limit $1`, [limit])).map(intentRow);
    },
    async expirePending() {
      await q(`update agent_intent set status = 'expired' where status = 'pending' and expires_at <= now()`);
    },
    async claimPending(id) {
      const rows = await q(
        `update agent_intent set status = 'failed', error = $2
         where id = $1 and status = 'pending' and expires_at > now() returning *`,
        [id, CONFIRMING],
      );
      return rows[0] ? intentRow(rows[0]) : null;
    },
    async finishIntent(id, patch) {
      await q(
        `update agent_intent set status = $2, signature = coalesce($3, signature), error = $4,
           confirmed_at = case when $2 = 'signed' then now() else confirmed_at end
         where id = $1`,
        [id, patch.status, patch.signature ?? null, patch.error ?? null],
      );
    },
    async upsertBuy(input) {
      await q(
        `insert into agent_position (mint, symbol, qty, cost_usd) values ($1, $2, $3, $4)
         on conflict (mint) do update set qty = excluded.qty, symbol = coalesce(excluded.symbol, agent_position.symbol),
           cost_usd = agent_position.cost_usd + excluded.cost_usd, updated_at = now()`,
        [input.mint, input.symbol, input.qty, input.costUsd],
      );
    },
    async closePosition(mint) {
      await q(`delete from agent_position where mint = $1`, [mint]);
    },
  };
}
