export type Chain =
  | 'solana'
  | 'base'
  | 'bnb'
  | 'ethereum'
  | 'robinhood'
  | 'monad'
  | 'hyperliquid'
  | 'other';

export interface Position {
  id: string;
  token: string;
  symbol: string;
  mint?: string;
  chain: Chain;
  sizeUsd: number;
  amount?: number;
  entryPrice: number;
  currentPrice: number;
  entryMcap: number;
  currentMcap: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  holdTimeHours: number;
  entryDate: string;
  thesis?: string;
  liquidityUsd?: number;
  source: 'fomo' | 'onchain' | 'merged';
}

export interface ClosedTrade {
  id: string;
  token: string;
  symbol: string;
  mint?: string;
  chain: Chain | string;
  side: 'long';
  sizeUsd: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  realizedPnlPct: number;
  holdTimeHours: number;
  entryDate: string;
  exitDate: string;
  rMultiple?: number;
  notes?: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
  realizedPnl: number;
}

export interface PnlWindows {
  h24: number | null;
  d7: number | null;
  d30: number | null;
  all: number | null;
}

export interface Influence {
  followers: number;
  following: number | null;
  leaderboardRank?: number;
  rankWindow?: '24h' | '7d' | '30d' | 'all';
  thesisCount?: number;
  averageHoldTimeHours?: number;
  accountAgeDays?: number;
}

export interface PortfolioSummary {
  totalEquity: number;
  cashUsd: number;
  openPositionsValue: number;
  realizedPnlAllTime: number;
  realizedPnl7d: number | null;
  realizedPnl30d: number | null;
  unrealizedPnl: number;
  peakEquity: number;
  currentDrawdownPct: number;
  winRate: number;
  profitFactor: number;
  avgRMultiple: number;
  totalTrades: number;
  closedTradesCaptured: number;
  followers: number;
  leaderboardRank?: number;
}

export interface PortfolioAlert {
  id: string;
  level: 'info' | 'warn' | 'crit';
  message: string;
}

export interface DataSourceInfo {
  fomo: boolean;
  onchain: boolean;
  fetchedAt: string;
  warnings: string[];
}

export interface Wallets {
  solana?: string;
  evm?: string;
}

export interface PortfolioSnapshot {
  handle?: string;
  displayName?: string;
  wallets: Wallets;
  source: DataSourceInfo;
  summary: PortfolioSummary;
  influence: Influence;
  pnlWindows: PnlWindows;
  openPositions: Position[];
  closedTrades: ClosedTrade[];
  equityCurve: EquityPoint[];
  alerts: PortfolioAlert[];
}

export interface LoadPortfolioInput {
  handle?: string;
  apiKey?: string;
  solanaWallet?: string;
  evmWallet?: string;
  solanaRpcUrl?: string;
  heliusApiKey?: string;
  fetchFn?: typeof fetch;
}
