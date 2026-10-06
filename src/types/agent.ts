export type AgentIntentStatus = 'rejected' | 'pending' | 'expired' | 'signed' | 'failed';

export interface AgentIntent {
  id: string;
  handle: string;
  mint: string;
  symbol: string | null;
  side: 'buy' | 'sell';
  status: AgentIntentStatus;
  reason: string | null;
  rejectReason: string | null;
  sizeUsd: number | null;
  quoteOut: string | null;
  priceImpactPct: number | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  signature: string | null;
  error: string | null;
  createdAt: string;
}

export interface AgentPosition {
  mint: string;
  symbol: string | null;
  qty: string;
  costUsd: number;
  openedAt: string;
  updatedAt: string;
}

export interface AgentState {
  address: string;
  capUsd: number;
  equityUsd: number | null;
  usdc: number | null;
  sol: number | null;
  deployedUsd: number;
  withdrawAddress: string | null;
  positions: AgentPosition[];
  intents: AgentIntent[];
  pendingCount: number;
  warnings: string[];
}

/** Book numbers already on the page; the intent route re-derives the veto from these instead of loading the portfolio. */
export interface IntentBook {
  equity: number;
  cashUsd?: number;
  cashPct: number;
  drawdownPct: number;
  top3Pct?: number;
  topNamePct?: number;
}

export interface IntentRequest {
  handle: string;
  mint: string;
  side: 'buy' | 'sell';
  reason?: string;
  book?: IntentBook | null;
}

/** Error text on an intent while its confirm call holds the claim. */
export const CONFIRMING = 'confirm in progress';
