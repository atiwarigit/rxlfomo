export type PlayDecision = 'watch' | 'size';

export type RunnerLabel = 'early' | 'building' | 'chase';

export type TapeSource = 'dex-boost' | 'dex-profile' | 'gecko-new' | 'gecko-trending';

export interface TapeRow {
  chain: string;
  mint: string;
  symbol: string;
  name: string;
  dexId: string;
  quoteSymbol: string;
  liquidityUsd: number;
  volume1hUsd: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  launchedAt: string | null;
  change5mPct: number | null;
  change1hPct: number | null;
  change6hPct: number | null;
  buys1h: number | null;
  sells1h: number | null;
  ageHours: number | null;
  pairUrl: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  sources: TapeSource[];
}

export interface PlayRules {
  maxNamePct: number;
  minCashPct: number;
  drawdownCutPct: number;
  maxTop3Pct: number;
}

export interface PlayBook {
  handle: string;
  equity: number;
  cashPct: number;
  drawdownPct: number;
  vetoes: string[];
  sizeFloorLiq: number;
}

export interface Play {
  account: string;
  mint: string;
  symbol: string;
  chain: string;
  launchpad: string;
  themes: string[];
  trigger: string;
  bookEdge: string;
  sizeCapUsd: number;
  vetoes: string[];
  decision: PlayDecision;
  lastCall: string;
  reason: string;
  score: number;
  bookFit: 'fits' | 'new';
  liquidityUsd: number;
  volume1hUsd: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  launchedAt: string | null;
  change5mPct: number | null;
  change1hPct: number | null;
  change6hPct: number | null;
  buys1h: number | null;
  sells1h: number | null;
  ageHours: number | null;
  runnerScore: number;
  runnerLabel: RunnerLabel;
  pairUrl: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  sources: TapeSource[];
}

export interface PlaysResponse {
  generatedAt: string;
  tapeCount: number;
  rules: PlayRules;
  books: PlayBook[];
  plays: Play[];
}
