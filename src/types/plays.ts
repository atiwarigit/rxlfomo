export type PlayDecision = 'watch' | 'size';

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
  change1hPct: number | null;
  ageHours: number | null;
  pairUrl: string;
  sources: TapeSource[];
}

export interface PlayRules {
  maxNamePct: number;
  minCashPct: number;
  drawdownCutPct: number;
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
  liquidityUsd: number;
  volume1hUsd: number;
  change1hPct: number | null;
  ageHours: number | null;
  pairUrl: string;
  sources: TapeSource[];
}

export interface PlaysResponse {
  generatedAt: string;
  tapeCount: number;
  rules: PlayRules;
  books: PlayBook[];
  plays: Play[];
}
