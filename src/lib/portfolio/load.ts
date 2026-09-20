import { createFomoClient, FomoApiError } from '../fomo/client.ts';
import type { FomoHolding, FomoPosition, FomoUser } from '../fomo/types.ts';
import { fetchDexMarkets, fetchSolPriceUsd, type TokenMarket } from '../wallet/markets.ts';
import { fetchSolanaHoldings, type OnchainHolding } from '../wallet/solana.ts';
import {
  asNumber,
  hoursBetween,
  isCashAsset,
  normalizeChain,
} from './helpers.ts';
import { buildAlerts, buildEquityCurve, drawdownPct, statsFromClosed } from './metrics.ts';
import type {
  ClosedTrade,
  LoadPortfolioInput,
  PortfolioSnapshot,
  Position,
} from '../../types/portfolio.ts';

const DUST_USD = 5;
const WSOL = 'So11111111111111111111111111111111111111112';

function tokenField(row: FomoPosition): { symbol: string; address?: string } {
  if (row.token && typeof row.token === 'object') {
    return {
      symbol: row.token.symbol || row.symbol || 'UNKNOWN',
      address: row.token.address || row.token.mint || row.tokenAddress,
    };
  }
  return {
    symbol: row.symbol || (typeof row.token === 'string' ? row.token : 'UNKNOWN'),
    address: row.tokenAddress,
  };
}

function isOpenRow(row: FomoPosition): boolean {
  const s = (row.status || '').toLowerCase();
  if (s === 'closed' || s === 'exited' || Boolean(row.closedAt)) return false;
  if (s === 'open' || s === 'active' || s === 'opened') return true;
  return !row.avgExitPrice;
}

function mapOpenPosition(row: FomoPosition, markets: Map<string, TokenMarket>): Position | null {
  const token = tokenField(row);
  const amount = asNumber(row.amount);
  const entry = asNumber(row.avgEntryPrice);
  const livePrice =
    asNumber(row.priceUsd) ||
    (token.address ? markets.get(token.address)?.priceUsd ?? 0 : 0);
  const cost = asNumber(row.costBasisUsd) || (entry > 0 && amount > 0 ? entry * amount : 0);
  const mtm = livePrice > 0 && amount > 0 ? livePrice * amount : cost;
  const sizeUsd = mtm || cost;
  if (sizeUsd < DUST_USD && asNumber(row.unrealizedPnlUsd) === 0) return null;
  const unrealized =
    row.unrealizedPnlUsd != null
      ? asNumber(row.unrealizedPnlUsd)
      : livePrice && entry
        ? (livePrice - entry) * amount
        : 0;
  const market = token.address ? markets.get(token.address) : undefined;
  const opened = row.createdAt || row.openedAt || new Date().toISOString();
  return {
    id: row.tradeId || row.id || `${token.symbol}-${opened}`,
    token: token.symbol,
    symbol: token.symbol,
    mint: token.address,
    chain: normalizeChain(row.chain, row.networkId ?? (typeof row.token === 'object' ? row.token.networkId : undefined)),
    sizeUsd,
    amount,
    entryPrice: entry,
    currentPrice: livePrice || entry,
    entryMcap: asNumber(row.entryMarketCapUsd),
    currentMcap: asNumber(row.marketCapUsd) || market?.marketCapUsd || 0,
    unrealizedPnl: unrealized,
    unrealizedPnlPct: cost > 0 ? (unrealized / cost) * 100 : 0,
    holdTimeHours: hoursBetween(opened),
    entryDate: opened,
    thesis: row.thesis,
    liquidityUsd: asNumber(row.liquidityUsd) || market?.liquidityUsd || undefined,
    source: 'fomo',
  };
}

function mapClosedTrade(row: FomoPosition): ClosedTrade | null {
  const token = tokenField(row);
  const entry = asNumber(row.avgEntryPrice);
  const exit = asNumber(row.avgExitPrice);
  const cost = asNumber(row.costBasisUsd);
  const pnl = asNumber(row.realizedPnlUsd);
  const sizeUsd = cost || (entry > 0 && asNumber(row.boughtAmount) > 0 ? entry * asNumber(row.boughtAmount) : Math.abs(pnl));
  const opened = row.createdAt || row.openedAt || row.closedAt || new Date().toISOString();
  const closed = row.closedAt || opened;
  if (!token.symbol) return null;
  return {
    id: row.tradeId || row.id || `${token.symbol}-${closed}`,
    token: token.symbol,
    symbol: token.symbol,
    mint: token.address,
    chain: normalizeChain(row.chain, row.networkId ?? (typeof row.token === 'object' ? row.token.networkId : undefined)),
    side: 'long',
    sizeUsd,
    entryPrice: entry,
    exitPrice: exit,
    realizedPnl: pnl,
    realizedPnlPct: sizeUsd > 0 ? (pnl / sizeUsd) * 100 : 0,
    holdTimeHours: hoursBetween(opened, closed),
    entryDate: opened,
    exitDate: closed,
  };
}

function holdingSymbol(h: FomoHolding): { symbol: string; address?: string; chain?: string; networkId?: number } {
  if (h.token) {
    return {
      symbol: h.token.symbol || h.symbol || 'UNKNOWN',
      address: h.token.address || h.token.mint || h.address,
      chain: h.chain,
      networkId: h.token.networkId ?? h.networkId,
    };
  }
  return {
    symbol: h.symbol || 'UNKNOWN',
    address: h.address,
    chain: h.chain,
    networkId: h.networkId,
  };
}

function mapHoldingToPosition(
  h: FomoHolding,
  markets: Map<string, TokenMarket>,
): Position | null {
  const tok = holdingSymbol(h);
  const amount = asNumber(h.amount);
  const price = asNumber(h.priceUsd) || (tok.address ? markets.get(tok.address)?.priceUsd ?? 0 : 0);
  const value = asNumber(h.valueUsd) || amount * price;
  if (value < DUST_USD) return null;
  const market = tok.address ? markets.get(tok.address) : undefined;
  return {
    id: `bal-${tok.address || tok.symbol}`,
    token: tok.symbol,
    symbol: tok.symbol,
    mint: tok.address,
    chain: normalizeChain(tok.chain, tok.networkId),
    sizeUsd: value,
    amount,
    entryPrice: price,
    currentPrice: price,
    entryMcap: market?.marketCapUsd || asNumber(h.marketCapUsd),
    currentMcap: market?.marketCapUsd || asNumber(h.marketCapUsd),
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 0,
    entryDate: new Date().toISOString(),
    liquidityUsd: market?.liquidityUsd || asNumber(h.liquidityUsd) || undefined,
    source: 'fomo',
  };
}

function mapOnchainPosition(
  h: OnchainHolding,
  markets: Map<string, TokenMarket>,
  solPrice: number,
): Position | null {
  const market = markets.get(h.mint);
  const price =
    h.priceUsd ??
    market?.priceUsd ??
    (h.mint === WSOL || h.native ? solPrice : 0);
  const value = h.valueUsd ?? (price > 0 ? h.amount * price : 0);
  if (value < DUST_USD) return null;
  const symbol = h.symbol || market?.symbol || h.mint.slice(0, 6);
  return {
    id: `onchain-${h.mint}`,
    token: symbol,
    symbol,
    mint: h.mint,
    chain: 'solana',
    sizeUsd: value,
    amount: h.amount,
    entryPrice: price,
    currentPrice: price,
    entryMcap: market?.marketCapUsd || 0,
    currentMcap: market?.marketCapUsd || 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    holdTimeHours: 0,
    entryDate: new Date().toISOString(),
    liquidityUsd: market?.liquidityUsd,
    source: 'onchain',
  };
}

function mergePositions(fomo: Position[], onchain: Position[]): Position[] {
  const byMint = new Map<string, Position>();
  const noMint: Position[] = [];
  for (const p of fomo) {
    if (p.mint) byMint.set(p.mint.toLowerCase(), p);
    else noMint.push(p);
  }
  for (const p of onchain) {
    if (!p.mint) {
      noMint.push(p);
      continue;
    }
    const key = p.mint.toLowerCase();
    const existing = byMint.get(key);
    if (!existing) {
      byMint.set(key, p);
      continue;
    }
    byMint.set(key, {
      ...existing,
      sizeUsd: Math.max(existing.sizeUsd, p.sizeUsd),
      currentPrice: existing.currentPrice || p.currentPrice,
      currentMcap: existing.currentMcap || p.currentMcap,
      liquidityUsd: existing.liquidityUsd || p.liquidityUsd,
      source: 'merged',
    });
  }
  return [...byMint.values(), ...noMint];
}

function splitCash(positions: Position[]): { cash: Position[]; risk: Position[] } {
  const cash: Position[] = [];
  const risk: Position[] = [];
  for (const p of positions) {
    if (isCashAsset(p.symbol, p.mint)) cash.push(p);
    else risk.push(p);
  }
  return { cash, risk };
}

function findRank(traders: { handle?: string; rank?: number }[] | undefined, handle: string) {
  const h = handle.replace(/^@/, '').toLowerCase();
  return traders?.find((t) => (t.handle || '').replace(/^@/, '').toLowerCase() === h)?.rank;
}

export async function loadPortfolio(input: LoadPortfolioInput): Promise<PortfolioSnapshot> {
  const handle = input.handle?.replace(/^@/, '').trim();
  const fetchFn = input.fetchFn ?? fetch;
  const warnings: string[] = [];
  let user: FomoUser | null = null;
  let fomoPositions: FomoPosition[] = [];
  let fomoHoldings: FomoHolding[] = [];
  let closedTotalOnFomo: number | undefined;
  let livePerpPnl = 0;
  let fomoTotalValue: number | undefined;
  let fomoOk = false;
  let rank: number | undefined;

  if (handle && input.apiKey) {
    const client = createFomoClient({ apiKey: input.apiKey, fetchFn });
    const results = await Promise.allSettled([
      client.resolveUser(handle),
      client.positions(handle),
      client.balances(handle),
      client.leaderboard('all'),
    ]);

    const take = <T>(i: number, label: string): T | null => {
      const r = results[i];
      if (r.status === 'fulfilled') return r.value as T;
      const err = r.reason;
      if (err instanceof FomoApiError) {
        if (err.code === 'auth') warnings.push('FOMO API key rejected (401). Check FOMO_API_KEY.');
        else if (err.code === 'credits') warnings.push('FOMO API credits exhausted (402). Wallet path still runs.');
        else if (err.code === 'not_found') warnings.push(`FOMO handle @${handle} was not found.`);
        else warnings.push(`${label}: ${err.message}`);
      } else {
        warnings.push(`${label}: ${err instanceof Error ? err.message : 'failed'}`);
      }
      return null;
    };

    user = take<FomoUser>(0, 'Profile');
    const pos = take<Awaited<ReturnType<typeof client.positions>>>(1, 'Positions');
    const bal = take<Awaited<ReturnType<typeof client.balances>>>(2, 'Balances');
    const board = take<Awaited<ReturnType<typeof client.leaderboard>>>(3, 'Leaderboard');

    if (user && !user.error) fomoOk = true;
    if (pos) {
      fomoPositions = pos.positions ?? pos.trades ?? pos.items ?? [];
      closedTotalOnFomo = pos.closedTotalOnFomo;
      if (pos.available === false && !fomoPositions.length) {
        warnings.push('FOMO has not captured positions for this handle yet.');
      }
    }
    if (bal) {
      fomoHoldings = bal.holdings ?? bal.balances ?? [];
      fomoTotalValue = bal.totalValueUsd;
      const perp = bal.livePerpPnl;
      livePerpPnl = typeof perp === 'number' ? perp : asNumber(perp?.usd);
    }
    rank = findRank(board?.traders, handle);
  } else if (handle && !input.apiKey) {
    warnings.push('Set FOMO_API_KEY (or paste a key in Settings) to pull FOMO PnL, trades, and social stats.');
  } else if (!handle) {
    warnings.push('No FOMO handle set — running wallet / on-chain path only.');
  }

  const solanaWallet =
    input.solanaWallet?.trim() ||
    user?.wallets?.solana ||
    undefined;
  const evmWallet =
    input.evmWallet?.trim() ||
    user?.wallets?.evm ||
    user?.wallets?.ethereum ||
    undefined;

  let onchain: OnchainHolding[] = [];
  let onchainOk = false;
  if (solanaWallet) {
    try {
      onchain = await fetchSolanaHoldings({
        owner: solanaWallet,
        rpcUrl: input.solanaRpcUrl,
        heliusApiKey: input.heliusApiKey,
        fetchFn,
      });
      onchainOk = true;
    } catch (err) {
      warnings.push(
        `Solana wallet read failed: ${err instanceof Error ? err.message : 'RPC error'}`,
      );
    }
  } else {
    warnings.push('No Solana wallet yet. FOMO resolution or a manual address is required to mark-to-market on-chain.');
  }

  const mints = [
    ...fomoPositions.map((p) => tokenField(p).address),
    ...fomoHoldings.map((h) => holdingSymbol(h).address),
    ...onchain.map((h) => h.mint),
  ].filter((m): m is string => Boolean(m));

  const [markets, solPrice] = await Promise.all([
    fetchDexMarkets(mints, fetchFn),
    fetchSolPriceUsd(fetchFn),
  ]);

  const openFromFomo = fomoPositions
    .filter(isOpenRow)
    .map((p) => mapOpenPosition(p, markets))
    .filter((p): p is Position => Boolean(p));

  const closed = fomoPositions
    .filter((p) => {
      const s = (p.status || '').toLowerCase();
      return s === 'closed' || Boolean(p.closedAt);
    })
    .map(mapClosedTrade)
    .filter((t): t is ClosedTrade => Boolean(t));

  const fromBalances = fomoHoldings
    .map((h) => mapHoldingToPosition(h, markets))
    .filter((p): p is Position => Boolean(p));

  const fromChain = onchain
    .map((h) => mapOnchainPosition(h, markets, solPrice))
    .filter((p): p is Position => Boolean(p));

  // Prefer explicit FOMO open positions; fill gaps from balances + chain.
  const merged = mergePositions(
    openFromFomo.length ? openFromFomo : fromBalances,
    fromChain,
  );
  const { cash, risk } = splitCash(merged);

  const cashUsd = cash.reduce((s, p) => s + p.sizeUsd, 0);
  const openPositionsValue = risk.reduce((s, p) => s + p.sizeUsd, 0);
  const fomoUnrealized = openFromFomo.reduce((s, p) => s + p.unrealizedPnl, 0);
  const unrealized = fomoUnrealized + livePerpPnl;
  const chainTotal = [...cash, ...risk].reduce((s, p) => s + p.sizeUsd, 0);
  const totalEquity =
    fomoTotalValue && fomoTotalValue > 0
      ? fomoTotalValue + (livePerpPnl || 0)
      : chainTotal || openPositionsValue + cashUsd;

  const pnlWindows = {
    h24: user?.pnl?.['24h'] ?? null,
    d7: user?.pnl?.['7d'] ?? null,
    d30: user?.pnl?.['30d'] ?? null,
    all: user?.pnl?.all ?? user?.pnlUsd ?? null,
  };

  const closedStats = statsFromClosed(closed);
  const realizedAllTime =
    pnlWindows.all ??
    closed.reduce((s, t) => s + t.realizedPnl, 0);

  const equityCurve = buildEquityCurve(closed, totalEquity, realizedAllTime, unrealized);
  const peakEquity = Math.max(totalEquity, ...equityCurve.map((p) => p.equity), 0);
  const currentDrawdownPct = drawdownPct(totalEquity, peakEquity);
  const alerts = buildAlerts(totalEquity, cashUsd, risk, currentDrawdownPct);

  const followers = asNumber(user?.followers ?? user?.profile?.followers);
  const avgHold = user?.averageHoldTimeSeconds ?? user?.profile?.averageHoldTimeSeconds;

  return {
    handle: user?.handle || user?.userHandle || handle,
    displayName: user?.displayName,
    wallets: { solana: solanaWallet, evm: evmWallet },
    source: {
      fomo: fomoOk,
      onchain: onchainOk,
      fetchedAt: new Date().toISOString(),
      warnings,
    },
    summary: {
      totalEquity,
      cashUsd,
      openPositionsValue,
      realizedPnlAllTime: realizedAllTime,
      realizedPnl7d: pnlWindows.d7 ?? closedStats.realized7d,
      realizedPnl30d: pnlWindows.d30 ?? closedStats.realized30d,
      unrealizedPnl: unrealized,
      peakEquity,
      currentDrawdownPct,
      winRate: closedStats.winRate,
      profitFactor: closedStats.profitFactor,
      avgRMultiple: closedStats.avgRMultiple,
      totalTrades: closedTotalOnFomo || asNumber(user?.trades ?? user?.numTrades) || closedStats.totalTrades,
      closedTradesCaptured: closed.length,
      followers,
      leaderboardRank: rank,
    },
    influence: {
      followers,
      following: user?.following ?? user?.profile?.following ?? null,
      leaderboardRank: rank,
      rankWindow: rank != null ? 'all' : undefined,
      averageHoldTimeHours: avgHold != null ? avgHold / 3600 : undefined,
      accountAgeDays: user?.accountAgeDays ?? user?.profile?.accountAgeDays,
    },
    pnlWindows,
    openPositions: [...risk].sort((a, b) => b.sizeUsd - a.sizeUsd),
    closedTrades: closed.sort((a, b) => Date.parse(b.exitDate) - Date.parse(a.exitDate)),
    equityCurve,
    alerts,
  };
}
