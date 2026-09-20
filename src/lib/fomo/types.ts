export interface FomoWallets {
  solana?: string | null;
  evm?: string | null;
  ethereum?: string | null;
}

export interface FomoUser {
  handle?: string;
  userHandle?: string;
  displayName?: string;
  userId?: string;
  pnlUsd?: number;
  pnl?: {
    '24h'?: number;
    '7d'?: number;
    '30d'?: number;
    all?: number;
  };
  volumeUsd?: number;
  trades?: number;
  numTrades?: number;
  swapCount?: number;
  followers?: number;
  following?: number;
  holdings?: number;
  wallets?: FomoWallets;
  profile?: {
    followers?: number;
    following?: number;
    averageHoldTimeSeconds?: number;
    fomoCreatedAt?: string;
    accountAgeDays?: number;
    twitter?: string;
  };
  averageHoldTimeSeconds?: number;
  accountAgeDays?: number;
  createdAt?: string;
  verified?: boolean;
  description?: string;
  error?: string;
  message?: string;
}

export interface FomoTokenRef {
  symbol?: string;
  name?: string;
  address?: string;
  mint?: string;
  networkId?: number;
}

export interface FomoPosition {
  tradeId?: string;
  id?: string;
  token?: FomoTokenRef | string;
  tokenAddress?: string;
  symbol?: string;
  chain?: string;
  networkId?: number;
  status?: string;
  amount?: number;
  avgEntryPrice?: number | null;
  avgExitPrice?: number | null;
  realizedPnlUsd?: number | null;
  unrealizedPnlUsd?: number | null;
  costBasisUsd?: number | null;
  boughtAmount?: number | null;
  soldAmount?: number | null;
  priceUsd?: number | null;
  createdAt?: string;
  openedAt?: string;
  closedAt?: string | null;
  thesis?: string;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
  entryMarketCapUsd?: number | null;
}

export interface FomoPositionsResponse {
  available?: boolean;
  positions?: FomoPosition[];
  trades?: FomoPosition[];
  items?: FomoPosition[];
  closedTotalOnFomo?: number;
  nextCursor?: string | null;
  complete?: boolean;
  error?: string;
  message?: string;
  deprecation?: boolean;
}

export interface FomoHolding {
  token?: FomoTokenRef;
  symbol?: string;
  address?: string;
  chain?: string;
  networkId?: number;
  amount?: number;
  priceUsd?: number;
  valueUsd?: number;
  change24h?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
}

export interface FomoBalancesResponse {
  available?: boolean;
  holdings?: FomoHolding[];
  balances?: FomoHolding[];
  totalValueUsd?: number;
  byChain?: Record<string, { holdings?: number; valueUsd?: number }>;
  otherPnl?: number;
  livePerpPnl?: number | { usd?: number };
  hyperliquidPerps?: unknown;
  error?: string;
  message?: string;
}

export interface FomoLeaderboardTrader {
  rank?: number;
  handle?: string;
  userId?: string;
  pnlUsd?: number;
}

export interface FomoLeaderboardResponse {
  window?: string;
  traders?: FomoLeaderboardTrader[];
  error?: string;
}
