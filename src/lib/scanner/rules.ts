import { narrativesFor } from '../launchpad/classify.ts';
import type { PortfolioSnapshot } from '../../types/portfolio.ts';
import type { Play, PlayBook, PlayRules, RunnerLabel, TapeRow, TapeSource } from '../../types/plays.ts';

export const RULES: PlayRules = { maxNamePct: 15, minCashPct: 20, drawdownCutPct: -8, maxTop3Pct: 45 };

export const SCAN_CHAINS = new Set(['solana', 'base', 'bsc']);

export const MAX_RUNNER_AGE_HOURS = 48;
export const MIN_RUNNER_SCORE = 30;

const DROP_SYMBOLS = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'ETH', 'WETH', 'BNB', 'WBNB']);

interface Floors {
  minLiq: number;
  sizeFloorLiq: number;
}

const SMALL_BOOK: Floors = { minLiq: 3_000, sizeFloorLiq: 8_000 };
const LARGE_BOOK: Floors = { minLiq: 15_000, sizeFloorLiq: 40_000 };

const ACCOUNT_FLOORS: Record<string, Floors> = {
  busymeredog: SMALL_BOOK,
  softmereelk: LARGE_BOOK,
};

export function floorsFor(handle: string, equity: number): Floors {
  const known = ACCOUNT_FLOORS[handle.replace(/^@/, '').trim().toLowerCase()];
  if (known) return known;
  return equity >= 50_000 ? LARGE_BOOK : SMALL_BOOK;
}

export function droppedSymbol(symbol: string): boolean {
  return DROP_SYMBOLS.has(symbol.trim().toUpperCase());
}

/** Scanner launchpad map. Anything not listed is unknown and never counts as book fit. */
export function scannerLaunchpad(dexId: string, mint: string): string | undefined {
  const d = dexId.trim().toLowerCase();
  if (d === 'pump-fun' || d === 'pumpfun' || d === 'pumpswap' || (!mint.startsWith('0x') && mint.toLowerCase().endsWith('pump'))) {
    return 'Pump.fun';
  }
  if (d.startsWith('stonkfun')) return 'Stonk.fun';
  if (d.startsWith('pons')) return 'Pons';
  if (d.startsWith('bankr')) return 'Bankr';
  if (/^(raydium|meteora|orca)/.test(d)) return 'Direct / DEX';
  return undefined;
}

function signedPct(v: number): string {
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%`;
}

export interface BookNumbers {
  equity: number;
  cashPct: number;
  drawdownPct: number;
  top3Pct?: number;
}

export function bookNumbers(snap: PortfolioSnapshot): BookNumbers {
  const s = snap.summary;
  const equity = s.totalEquity || 0;
  const top3 = [...snap.openPositions]
    .map((p) => p.sizeUsd)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((a, b) => a + b, 0);
  return {
    equity,
    cashPct: equity > 0 ? (s.cashUsd / equity) * 100 : 0,
    drawdownPct: s.currentDrawdownPct || 0,
    top3Pct: equity > 0 ? (top3 / equity) * 100 : 0,
  };
}

/** Short clauses; the header joins them into one "Size $0 — …" sentence. */
export function bookVetoes(input: BookNumbers): string[] {
  const out: string[] = [];
  if (!(input.equity > 0)) out.push('book did not load live equity');
  if (input.cashPct < RULES.minCashPct) {
    out.push(`cash ${input.cashPct.toFixed(0)}% under the ${RULES.minCashPct}% floor`);
  }
  if (input.drawdownPct <= RULES.drawdownCutPct) {
    out.push(`drawdown ${signedPct(input.drawdownPct)} past the ${signedPct(RULES.drawdownCutPct)} cut`);
  }
  if ((input.top3Pct ?? 0) > RULES.maxTop3Pct) {
    out.push(`top 3 names ${input.top3Pct!.toFixed(0)}% over the ${RULES.maxTop3Pct}% cap`);
  }
  return out;
}

export function vetoSentence(vetoes: string[]): string {
  if (!vetoes.length) return '';
  return `Size $0 — ${vetoes.join(', ')}. These are watches, not entries.`;
}

export function bookFromSnapshot(handle: string, snap: PortfolioSnapshot): PlayBook {
  const nums = bookNumbers(snap);
  return {
    handle,
    equity: nums.equity,
    cashPct: nums.cashPct,
    drawdownPct: nums.drawdownPct,
    vetoes: bookVetoes(nums),
    sizeFloorLiq: floorsFor(handle, nums.equity).sizeFloorLiq,
  };
}

export interface EdgeRow {
  label: string;
  realizedUsd: number;
  closes: number;
  wins: number;
  dripPays: number;
}

export interface BookProfile {
  launchpads: Map<string, EdgeRow>;
  themes: Map<string, EdgeRow>;
  held: Set<string>;
}

function bump(map: Map<string, EdgeRow>, label: string): EdgeRow {
  let row = map.get(label);
  if (!row) {
    row = { label, realizedUsd: 0, closes: 0, wins: 0, dripPays: 0 };
    map.set(label, row);
  }
  return row;
}

function mintKey(mint: string): string {
  return mint.startsWith('0x') ? mint.toLowerCase() : mint;
}

export function bookProfile(snap: PortfolioSnapshot): BookProfile {
  const launchpads = new Map<string, EdgeRow>();
  const themes = new Map<string, EdgeRow>();
  const held = new Set<string>();
  for (const p of snap.openPositions) {
    if (p.mint) held.add(mintKey(p.mint));
    if (!p.dripPays) continue;
    if (p.launchpad) bump(launchpads, p.launchpad).dripPays += 1;
    for (const t of p.narratives || []) if (t !== 'Other') bump(themes, t).dripPays += 1;
  }
  for (const t of snap.closedTrades) {
    const rows = [
      ...(t.launchpad ? [bump(launchpads, t.launchpad)] : []),
      ...(t.narratives || []).filter((x) => x !== 'Other').map((x) => bump(themes, x)),
    ];
    for (const row of rows) {
      row.realizedUsd += t.realizedPnl;
      row.closes += 1;
      if (t.realizedPnl > 0) row.wins += 1;
    }
  }
  return { launchpads, themes, held };
}

/** Open P&L never counts: a bucket fits only after a realized win or a drip on this account. */
function paid(row?: EdgeRow): row is EdgeRow {
  return Boolean(row && (row.wins > 0 || row.dripPays > 0));
}

export function runnerScore(input: {
  ageHours: number | null;
  change1hPct: number | null;
  buys1h: number | null;
  sells1h: number | null;
  liquidityUsd: number;
  volume1hUsd: number;
  floors: Floors;
}): number {
  const age = input.ageHours;
  const fresh = age == null ? 0 : age < 2 ? 30 : age < 6 ? 22 : age < 24 ? 12 : age < 48 ? 4 : 0;

  const chg = input.change1hPct;
  const early = chg == null || chg < 0 ? 0 : chg >= 8 && chg <= 45 ? 20 : chg > 80 ? 4 : 10;

  const buys = input.buys1h ?? 0;
  const txns = buys + (input.sells1h ?? 0);
  const share = txns > 0 ? buys / txns : null;
  const buyers = share == null ? 0 : share >= 0.58 && txns >= 40 ? 20 : share < 0.45 ? 0 : 10;

  const liq = input.liquidityUsd;
  const exit = liq >= input.floors.sizeFloorLiq ? 20 : liq < input.floors.minLiq ? 0 : 10;

  const turnover = liq > 0 ? input.volume1hUsd / liq : Infinity;
  const wash = turnover < 8 ? 10 : turnover > 20 ? 0 : 5;

  return fresh + early + buyers + exit + wash;
}

export function runnerLabel(score: number): RunnerLabel | null {
  if (score >= 75) return 'early';
  if (score >= 50) return 'building';
  if (score >= MIN_RUNNER_SCORE) return 'chase';
  return null;
}

const SOURCE_LABEL: Record<TapeSource, string> = {
  'dex-boost': 'Dex boost',
  'dex-profile': 'Dex profile',
  'gecko-new': 'Gecko new pool',
  'gecko-trending': 'Gecko trending 1h',
};

function usd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `$${a.toFixed(0)}`;
}

function ageText(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${h.toFixed(0)}h`;
  return `${Math.round(h / 24)}d`;
}

function dedupe(plays: Play[]): Play[] {
  const seenMint = new Set<string>();
  const seenSymbol = new Set<string>();
  const out: Play[] = [];
  for (const p of plays) {
    const m = `${p.chain}:${mintKey(p.mint)}`;
    const sym = p.symbol.trim().toUpperCase();
    if (seenMint.has(m) || seenSymbol.has(sym)) continue;
    seenMint.add(m);
    seenSymbol.add(sym);
    out.push(p);
  }
  return out;
}

export function buildPlays(input: {
  handle: string;
  book: PortfolioSnapshot;
  tape: TapeRow[];
  limit?: number;
}): { book: PlayBook; plays: Play[] } {
  const book = bookFromSnapshot(input.handle, input.book);
  const floors = floorsFor(input.handle, book.equity);
  const profile = bookProfile(input.book);
  const cashAboveFloor = input.book.summary.cashUsd - (book.equity * RULES.minCashPct) / 100;
  const nameCap = (book.equity * RULES.maxNamePct) / 100;
  const plays: Play[] = [];

  for (const row of input.tape) {
    if (!SCAN_CHAINS.has(row.chain) || droppedSymbol(row.symbol)) continue;
    if (profile.held.has(mintKey(row.mint))) continue;
    if (row.liquidityUsd < floors.minLiq) continue;
    if (row.ageHours == null || row.ageHours > MAX_RUNNER_AGE_HOURS) continue;

    const score = runnerScore({ ...row, floors });
    const label = runnerLabel(score);
    if (!label) continue;

    const launchpad = scannerLaunchpad(row.dexId, row.mint);
    const themes = narrativesFor({ symbol: row.symbol, name: row.name, quote: row.quoteSymbol }).filter(
      (t) => t !== 'Other',
    );
    const padRow = launchpad ? profile.launchpads.get(launchpad) : undefined;
    const fitTheme = themes.find((t) => paid(profile.themes.get(t)));
    const fitsPad = paid(padRow);
    const bookFit = fitsPad || fitTheme ? 'fits' : 'new';
    const bookEdge = fitsPad ? `Fits ${launchpad}` : fitTheme ? `Fits ${fitTheme.toLowerCase()}` : 'New to this book';

    const cardVetoes: string[] = [];
    if (row.liquidityUsd < floors.sizeFloorLiq) {
      cardVetoes.push(`liquidity ${usd(row.liquidityUsd)} under the ${usd(floors.sizeFloorLiq)} size floor`);
    }
    if (bookFit === 'new') cardVetoes.push('no realized win or drip on this launchpad or theme yet');
    const rawCap = Math.floor(Math.min(nameCap, cashAboveFloor));
    if (!book.vetoes.length && !cardVetoes.length && rawCap <= 0) {
      cardVetoes.push(`no cash above the ${RULES.minCashPct}% floor`);
    }
    const vetoes = [...book.vetoes, ...cardVetoes];
    const decision = vetoes.length ? 'watch' : 'size';
    const sizeCapUsd = decision === 'size' ? rawCap : 0;
    const buys = row.buys1h ?? 0;
    const txns = buys + (row.sells1h ?? 0);
    const chg = row.change1hPct;

    plays.push({
      account: input.handle,
      mint: row.mint,
      symbol: row.symbol,
      chain: row.chain,
      launchpad: launchpad || 'Unknown',
      themes,
      trigger: row.sources.map((x) => SOURCE_LABEL[x]).join(' + ') || 'tape',
      bookEdge,
      bookFit,
      sizeCapUsd,
      vetoes,
      decision,
      lastCall: decision === 'size' ? `SIZE_UP_TO_${sizeCapUsd}` : `WATCH_${label.toUpperCase()}`,
      reason: `Launched ${ageText(row.ageHours)} ago, ${chg == null ? '1h n/a' : `${chg >= 0 ? '+' : ''}${chg.toFixed(0)}% in 1h`}, ${txns ? `${Math.round((buys / txns) * 100)}% buys over ${txns} txns` : 'no 1h txns'}, ${usd(row.liquidityUsd)} liquidity.`,
      score,
      runnerScore: score,
      runnerLabel: label,
      liquidityUsd: row.liquidityUsd,
      volume1hUsd: row.volume1hUsd,
      marketCapUsd: row.marketCapUsd,
      fdvUsd: row.fdvUsd,
      launchedAt: row.launchedAt,
      change5mPct: row.change5mPct,
      change1hPct: row.change1hPct,
      change6hPct: row.change6hPct,
      buys1h: row.buys1h,
      sells1h: row.sells1h,
      ageHours: row.ageHours,
      pairUrl: row.pairUrl,
      sources: row.sources,
    });
  }

  plays.sort((a, b) => b.runnerScore - a.runnerScore || b.liquidityUsd - a.liquidityUsd);
  return { book, plays: dedupe(plays).slice(0, input.limit ?? 12) };
}

/** Re-apply book vetoes computed from the book on screen (it carries the browser's peak). */
export function applyBookVetoes(plays: Play[], vetoes: string[], routeVetoes: string[] = []): Play[] {
  if (!vetoes.length) return plays;
  const drop = new Set([...vetoes, ...routeVetoes]);
  return plays.map((p) => ({
    ...p,
    vetoes: [...vetoes, ...p.vetoes.filter((v) => !drop.has(v))],
    decision: 'watch',
    sizeCapUsd: 0,
    lastCall: `WATCH_${p.runnerLabel.toUpperCase()}`,
  }));
}
