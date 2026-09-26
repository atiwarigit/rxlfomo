import { createFomoClient, FomoApiError } from '../fomo/client.ts';
import type { FomoHolding, FomoPosition, FomoSearchTrader, FomoUser } from '../fomo/types.ts';
import { fetchDexMarkets, fetchSolPriceUsd, type TokenMarket } from '../wallet/markets.ts';
import { fetchSolanaHoldings, type OnchainHolding } from '../wallet/solana.ts';
import {
  asNumber,
  hoursBetween,
  inferredEntryMcap,
  isCashAsset,
  normalizeChain,
  pnlFromChangePct,
} from './helpers.ts';
import { buildAlerts, buildEquityCurve, drawdownPct, statsFromClosed } from './metrics.ts';
import { closedFromRelaySwaps, positionsFromRelaySwaps } from './relayPositions.ts';
import { fetchRelayHistory } from '../relay/api.ts';
import { fetchTokenMeta, type TokenMeta } from '../launchpad/gecko.ts';
import type {
  ClosedTrade,
  LoadPortfolioInput,
  PortfolioSnapshot,
  Position,
} from '../../types/portfolio.ts';

const DUST_USD = 5;
const WSOL = 'So11111111111111111111111111111111111111112';

function marketFor(mint: string | undefined, markets: Map<string, TokenMarket>): TokenMarket | undefined {
  if (!mint) return undefined;
  return markets.get(mint) || markets.get(mint.toLowerCase());
}

function withMarketMove(p: Position, markets: Map<string, TokenMarket>): Position {
  const market = marketFor(p.mint, markets);
  const currentPrice = market?.priceUsd || p.currentPrice || 0;
  const amount = p.amount || 0;
  const sizeUsd = currentPrice > 0 && amount > 0 ? currentPrice * amount : p.sizeUsd;
  const change24hPct = p.change24hPct ?? market?.change24hPct;
  const currentMcap = market?.marketCapUsd || p.currentMcap || 0;
  const entryMcap =
    p.entryMcap ||
    (p.hasCostBasis ? inferredEntryMcap(currentMcap, p.entryPrice, currentPrice) : 0);
  const cost = p.hasCostBasis && p.entryPrice > 0 && amount > 0 ? p.entryPrice * amount : 0;
  const unrealizedPnl =
    cost > 0 && currentPrice > 0 ? (currentPrice - p.entryPrice) * amount : p.unrealizedPnl;
  const unrealizedPnlPct = cost > 0 ? (unrealizedPnl / cost) * 100 : p.unrealizedPnlPct;
  const pnl24hUsd =
    change24hPct != null ? pnlFromChangePct(sizeUsd, change24hPct) : p.pnl24hUsd;
  return {
    ...p,
    sizeUsd,
    currentPrice: currentPrice || p.currentPrice,
    currentMcap,
    entryMcap,
    unrealizedPnl,
    unrealizedPnlPct,
    liquidityUsd: p.liquidityUsd || market?.liquidityUsd,
    change24hPct,
    pnl24hUsd,
    volume24hUsd: p.volume24hUsd ?? market?.volume24hUsd,
  };
}

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
  return true;
}

function mapOpenPosition(row: FomoPosition, markets: Map<string, TokenMarket>): Position | null {
  const token = tokenField(row);
  const amount = asNumber(row.amount);
  const entry = asNumber(row.avgEntryPrice);
  const livePrice =
    asNumber(row.priceUsd) ||
    marketFor(token.address, markets)?.priceUsd ||
    asNumber(row.avgExitPrice);
  const cost = asNumber(row.costBasisUsd) || (entry > 0 && amount > 0 ? entry * amount : 0);
  const mtm = livePrice > 0 && amount > 0 ? livePrice * amount : cost;
  const sizeUsd = mtm || cost;
  if (sizeUsd < DUST_USD && asNumber(row.unrealizedPnlUsd) === 0) return null;
  const hasCostBasis = entry > 0 && cost > 0;
  const unrealized =
    livePrice > 0 && entry > 0 && amount > 0
      ? (livePrice - entry) * amount
      : asNumber(row.unrealizedPnlUsd);
  const market = marketFor(token.address, markets);
  const opened = row.createdAt || row.openedAt || new Date().toISOString();
  const currentPrice = livePrice || entry;
  const currentMcap = asNumber(row.marketCapUsd) || market?.marketCapUsd || 0;
  return {
    id: row.tradeId || row.id || `${token.symbol}-${opened}`,
    token: token.symbol,
    symbol: token.symbol,
    mint: token.address,
    chain: normalizeChain(row.chain, row.networkId ?? (typeof row.token === 'object' ? row.token.networkId : undefined)),
    sizeUsd,
    amount,
    entryPrice: entry,
    currentPrice,
    entryMcap: asNumber(row.entryMarketCapUsd) || inferredEntryMcap(currentMcap, entry, currentPrice),
    currentMcap,
    unrealizedPnl: unrealized,
    unrealizedPnlPct: cost > 0 ? (unrealized / cost) * 100 : 0,
    holdTimeHours: hoursBetween(opened),
    entryDate: opened,
    thesis: row.thesis,
    liquidityUsd: asNumber(row.liquidityUsd) || market?.liquidityUsd || undefined,
    source: 'fomo',
    hasCostBasis,
    change24hPct: market?.change24hPct,
    pnl24hUsd: market?.change24hPct != null ? pnlFromChangePct(sizeUsd, market.change24hPct) : undefined,
    volume24hUsd: market?.volume24hUsd,
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
  const market = marketFor(tok.address, markets);
  const amount = asNumber(h.amount);
  const price = asNumber(h.priceUsd) || market?.priceUsd || 0;
  const value = asNumber(h.valueUsd) || amount * price;
  if (value < DUST_USD) return null;
  const change24hPct =
    h.change24h != null && h.change24h !== undefined
      ? asNumber(h.change24h)
      : market?.change24hPct;
  const pnl24hUsd = change24hPct != null ? pnlFromChangePct(value, change24hPct) : undefined;
  return {
    id: `bal-${tok.address || tok.symbol}`,
    token: tok.symbol,
    symbol: tok.symbol,
    mint: tok.address,
    chain: normalizeChain(tok.chain, tok.networkId),
    sizeUsd: value,
    amount,
    entryPrice: 0,
    currentPrice: price,
    entryMcap: 0,
    currentMcap: market?.marketCapUsd || asNumber(h.marketCapUsd),
    unrealizedPnl: pnl24hUsd ?? 0,
    unrealizedPnlPct: change24hPct || 0,
    holdTimeHours: 0,
    entryDate: new Date().toISOString(),
    liquidityUsd: market?.liquidityUsd || asNumber(h.liquidityUsd) || undefined,
    source: 'fomo',
    hasCostBasis: false,
    change24hPct: change24hPct || undefined,
    pnl24hUsd,
  };
}

function mapOnchainPosition(
  h: OnchainHolding,
  markets: Map<string, TokenMarket>,
  solPrice: number,
): Position | null {
  const market = marketFor(h.mint, markets);
  const price =
    h.priceUsd ??
    market?.priceUsd ??
    (h.mint === WSOL || h.native ? solPrice : 0);
  const value = h.valueUsd ?? (price > 0 ? h.amount * price : 0);
  if (value < DUST_USD) return null;
  const symbol = h.symbol || market?.symbol || h.mint.slice(0, 6);
  const change24hPct = market?.change24hPct;
  const pnl24hUsd = change24hPct != null ? pnlFromChangePct(value, change24hPct) : undefined;
  return {
    id: `onchain-${h.mint}`,
    token: symbol,
    symbol,
    mint: h.mint,
    chain: 'solana',
    sizeUsd: value,
    amount: h.amount,
    entryPrice: 0,
    currentPrice: price,
    entryMcap: 0,
    currentMcap: market?.marketCapUsd || 0,
    unrealizedPnl: pnl24hUsd ?? 0,
    unrealizedPnlPct: change24hPct ?? 0,
    holdTimeHours: 0,
    entryDate: new Date().toISOString(),
    liquidityUsd: market?.liquidityUsd,
    source: 'onchain',
    hasCostBasis: false,
    change24hPct,
    pnl24hUsd,
    volume24hUsd: market?.volume24hUsd,
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
      amount: p.amount || existing.amount,
      currentPrice: p.currentPrice || existing.currentPrice,
      currentMcap: p.currentMcap || existing.currentMcap,
      liquidityUsd: existing.liquidityUsd || p.liquidityUsd,
      change24hPct: p.change24hPct ?? existing.change24hPct,
      pnl24hUsd: p.pnl24hUsd ?? existing.pnl24hUsd,
      volume24hUsd: p.volume24hUsd ?? existing.volume24hUsd,
      thesis: existing.thesis || p.thesis,
      hasCostBasis: Boolean(existing.hasCostBasis || p.hasCostBasis),
      source: existing.hasCostBasis || existing.source === 'fomo' ? 'merged' : p.source,
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

async function tagLaunchpads(open: Position[], closed: ClosedTrade[], fetchFn: typeof fetch) {
  const requests = [...open, ...closed]
    .filter((p) => p.mint)
    .map((p) => ({ address: p.mint as string, chain: p.chain, symbol: p.symbol }));
  let meta = new Map<string, TokenMeta>();
  try {
    meta = await fetchTokenMeta(requests, fetchFn);
  } catch {
    // tags are optional
  }
  for (const row of [...open, ...closed]) {
    const m = row.mint ? meta.get(row.mint.toLowerCase()) : undefined;
    if (!m) continue;
    row.launchpad = m.launchpad.label;
    row.launchpadId = m.launchpad.id;
    row.narratives = m.narratives;
    if ('currentPrice' in row) (row as Position).quoteSymbol = m.quote;
  }
}

export async function loadPortfolio(input: LoadPortfolioInput): Promise<PortfolioSnapshot> {
  const handle = input.handle?.replace(/^@/, '').trim();
  const fetchFn = input.fetchFn ?? fetch;
  const warnings: string[] = [];
  let user: FomoUser | null = null;
  let searchHit: FomoSearchTrader | null = null;
  let fomoPositions: FomoPosition[] = [];
  let fomoHoldings: FomoHolding[] = [];
  let relayOpen: Position[] = [];
  let relayClosed: ClosedTrade[] = [];
  let closedTotalOnFomo: number | undefined;
  let livePerpPnl = 0;
  let fomoTotalValue: number | undefined;
  let fomoOk = false;
  let rank: number | undefined;
  let solanaWallet = input.solanaWallet?.trim() || undefined;
  let evmWallet = input.evmWallet?.trim() || undefined;

  let onchainPromise: Promise<OnchainHolding[]> | undefined;
  const startOnchain = () => {
    if (onchainPromise || !solanaWallet) return;
    onchainPromise = fetchSolanaHoldings({
      owner: solanaWallet,
      rpcUrl: input.solanaRpcUrl,
      heliusApiKey: input.heliusApiKey,
      fetchFn,
    });
  };

  let fomoOutOfCredits = false;
  if (handle && input.apiKey) {
    const client = createFomoClient({ apiKey: input.apiKey, fetchFn });
    try {
      const found = await client.search(handle);
      const rows = found.results ?? found.traders ?? [];
      searchHit =
        rows.find(
          (r) => (r.handle || '').replace(/^@/, '').toLowerCase() === handle.toLowerCase(),
        ) ?? rows[0] ?? null;
      if (searchHit?.wallets?.solana) solanaWallet = solanaWallet || searchHit.wallets.solana;
      if (searchHit?.wallets?.evm) evmWallet = evmWallet || searchHit.wallets.evm;
      if (searchHit?.handle) fomoOk = true;
      startOnchain();
    } catch (err) {
      if (err instanceof FomoApiError && err.code === 'auth') {
        warnings.push('FOMO API key rejected (401). Check FOMO_API_KEY.');
      } else if (err instanceof FomoApiError && err.code === 'credits') {
        fomoOutOfCredits = true;
        warnings.push(
          'fomoapi.io is out of credits (402). Top up at fomoapi.io/pricing, or paste your Solana wallet in Sources so the wallet path can still mark the book.',
        );
      } else {
        warnings.push(`Search: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  }

  if (handle && input.apiKey && !fomoOutOfCredits) {
    const client = createFomoClient({ apiKey: input.apiKey, fetchFn });
    const fomoKey = searchHit?.userId || handle;
    const results = await Promise.allSettled([
      client.resolveUser(handle),
      client.positions(fomoKey),
      client.balances(fomoKey),
      client.leaderboard('all'),
      client.spotlight(handle),
      client.relaySwaps(handle),
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
    const spot = take<Awaited<ReturnType<typeof client.spotlight>>>(4, 'Spotlight');
    const relay = take<Awaited<ReturnType<typeof client.relaySwaps>>>(5, 'Relay');

    if (user && !user.error) fomoOk = true;
    if (user?.wallets?.solana) solanaWallet = solanaWallet || user.wallets.solana;
    if (user?.wallets?.evm || user?.wallets?.ethereum) {
      evmWallet = evmWallet || user.wallets.evm || user.wallets.ethereum || undefined;
    }
    startOnchain();
    if (pos) {
      fomoPositions = pos.positions ?? pos.trades ?? pos.items ?? [];
      closedTotalOnFomo = pos.closedTotalOnFomo;
      if (pos.available === false && !fomoPositions.length) {
        warnings.push('FOMO has not captured the full trade tape for this handle yet.');
      }
    }
    if (spot?.bestTrades?.length) {
      fomoPositions = [...fomoPositions, ...spot.bestTrades];
    }
    if (relay?.swaps?.length) {
      relayOpen = positionsFromRelaySwaps(relay.swaps);
    }
    if (bal) {
      fomoHoldings = bal.holdings ?? bal.balances ?? [];
      fomoTotalValue = bal.totalValueUsd;
      const perp = bal.livePerpPnl;
      livePerpPnl = typeof perp === 'number' ? perp : asNumber(perp?.usd);
      if (bal.available === false && !fomoHoldings.length) {
        warnings.push('FOMO holdings feed is empty; using wallet + Relay marks.');
      }
    }
    rank = findRank(board?.traders, handle);
  } else if (handle && !input.apiKey) {
    warnings.push('Set FOMO_API_KEY (or paste a key in Settings) to pull FOMO PnL, trades, and social stats.');
  } else if (!handle) {
    warnings.push('No FOMO handle set — running wallet / on-chain path only.');
  }

  let onchain: OnchainHolding[] = [];
  let onchainOk = false;
  startOnchain();
  const relayUser = solanaWallet || evmWallet;
  const relayPromise = relayUser ? fetchRelayHistory(relayUser, fetchFn) : undefined;
  let relayOk = false;
  if (relayPromise) {
    try {
      const history = await relayPromise;
      if (history.swaps.length) {
        relayOpen = positionsFromRelaySwaps(history.swaps);
        relayClosed = closedFromRelaySwaps(history.swaps);
        relayOk = true;
      }
      evmWallet = evmWallet || history.evmWallet;
      if (history.truncated) {
        warnings.push('Relay history was cut short (long history or rate limit); bags bought before the loaded window may be missing.');
      }
    } catch (err) {
      warnings.push(`Relay history: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  if (onchainPromise) {
    try {
      onchain = await onchainPromise;
      onchainOk = true;
    } catch (err) {
      warnings.push(
        `Solana wallet read failed: ${err instanceof Error ? err.message : 'RPC error'}`,
      );
    }
  } else {
    warnings.push('No Solana wallet yet. Paste the address in Sources (or set SOLANA_WALLET) so the book loads even when FOMO is down.');
  }

  const mints = [
    ...fomoPositions.map((p) => tokenField(p).address),
    ...fomoHoldings.map((h) => holdingSymbol(h).address),
    ...onchain.map((h) => h.mint),
    ...relayOpen.map((p) => p.mint),
  ].filter((m): m is string => Boolean(m));

  const [markets, solPrice] = await Promise.all([
    fetchDexMarkets(mints, fetchFn),
    fetchSolPriceUsd(fetchFn),
  ]);

  const openFromFomo = fomoPositions
    .filter(isOpenRow)
    .map((p) => mapOpenPosition(p, markets))
    .filter((p): p is Position => Boolean(p));

  const fomoClosed = fomoPositions
    .filter((p) => {
      const s = (p.status || '').toLowerCase();
      return s === 'closed' || Boolean(p.closedAt);
    })
    .map(mapClosedTrade)
    .filter((t): t is ClosedTrade => Boolean(t));
  const closed = fomoClosed.length ? fomoClosed : relayClosed;

  const fromBalances = fomoHoldings
    .map((h) => mapHoldingToPosition(h, markets))
    .filter((p): p is Position => Boolean(p));

  const fromChain = onchain
    .map((h) => mapOnchainPosition(h, markets, solPrice))
    .filter((p): p is Position => Boolean(p));

  const fromRelay = relayOpen.map((p) => withMarketMove(p, markets));
  const holdings = mergePositions(fromChain, fromRelay);
  const fomoBase = openFromFomo.length ? openFromFomo : fromBalances;
  const merged = mergePositions(fomoBase, holdings).map((p) => withMarketMove(p, markets));
  if (onchainOk && fromChain.length && openFromFomo.length > fromChain.length + 3) {
    warnings.push(
      `FOMO lists ${openFromFomo.length} open names vs ${fromChain.length} Solana tokens in the wallet — some FOMO rows can lag exits.`,
    );
  }
  const { cash, risk } = splitCash(merged);
  await tagLaunchpads(risk, closed, fetchFn);

  const cashUsd = cash.reduce((s, p) => s + p.sizeUsd, 0);
  const openPositionsValue = risk.reduce((s, p) => s + p.sizeUsd, 0);
  const hasCostBasis = risk.some((p) => p.hasCostBasis);
  const unrealized =
    risk.reduce((s, p) => s + (p.hasCostBasis ? p.unrealizedPnl : p.pnl24hUsd ?? 0), 0) +
    livePerpPnl;
  const pnl24h =
    [...cash, ...risk].reduce((s, p) => s + (p.pnl24hUsd ?? 0), 0) + livePerpPnl;
  const any24h = [...cash, ...risk].some((p) => p.pnl24hUsd != null);
  const chainTotal = [...cash, ...risk].reduce((s, p) => s + p.sizeUsd, 0);
  const totalEquity =
    fomoTotalValue && fomoTotalValue > 0
      ? fomoTotalValue + (livePerpPnl || 0)
      : chainTotal || openPositionsValue + cashUsd;

  const fomoAllTime = user?.pnl?.all ?? (user?.pnlUsd == null ? null : user.pnlUsd);
  const pnlWindows = {
    h24: user?.pnl?.['24h'] ?? (any24h ? pnl24h : null),
    d7: user?.pnl?.['7d'] ?? null,
    d30: user?.pnl?.['30d'] ?? null,
    all: fomoAllTime,
  };

  const closedStats = statsFromClosed(closed);
  const closedSum = closed.reduce((s, t) => s + t.realizedPnl, 0);
  const spotlightRealized = fomoPositions.reduce((s, p) => s + asNumber(p.realizedPnlUsd), 0);
  const realizedAllTime =
    fomoAllTime ??
    (closed.length ? closedSum : spotlightRealized ? spotlightRealized : null);

  let equityCurve = buildEquityCurve(closed, totalEquity, realizedAllTime ?? 0, hasCostBasis ? unrealized : 0);
  const peakEquity = Math.max(totalEquity, ...equityCurve.map((p) => p.equity), 0);
  if (equityCurve.length < 2 && pnlWindows.h24 != null) {
    const today = new Date().toISOString().slice(0, 10);
    const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    equityCurve = [
      { date: yday, equity: Math.max(0, totalEquity - pnlWindows.h24), realizedPnl: 0 },
      { date: today, equity: totalEquity, realizedPnl: realizedAllTime ?? 0 },
    ];
  }
  const currentDrawdownPct = drawdownPct(totalEquity, peakEquity);
  const alerts = buildAlerts(totalEquity, cashUsd, risk, currentDrawdownPct);

  const followers = asNumber(user?.followers ?? user?.profile?.followers);
  const avgHold = user?.averageHoldTimeSeconds ?? user?.profile?.averageHoldTimeSeconds;
  const volumeUsd = user?.volumeUsd ?? user?.totalVolume ?? user?.profile?.totalVolumeUsd ?? null;

  return {
    handle: user?.handle || user?.userHandle || searchHit?.handle || handle,
    displayName: user?.displayName || searchHit?.displayName,
    wallets: { solana: solanaWallet, evm: evmWallet },
    source: {
      fomo: fomoOk,
      onchain: onchainOk || relayOk,
      fetchedAt: new Date().toISOString(),
      warnings: [...new Set(warnings)],
    },
    summary: {
      totalEquity,
      cashUsd,
      openPositionsValue,
      realizedPnlAllTime: realizedAllTime,
      realizedPnl7d: pnlWindows.d7 ?? closedStats.realized7d,
      realizedPnl30d: pnlWindows.d30 ?? closedStats.realized30d,
      unrealizedPnl: unrealized,
      volumeUsd,
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
