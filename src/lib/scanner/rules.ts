import { narrativesFor } from '../launchpad/classify.ts';
import type { PortfolioSnapshot } from '../../types/portfolio.ts';
import type { Play, PlayBook, PlayRules, TapeRow, TapeSource } from '../../types/plays.ts';

export const RULES: PlayRules = { maxNamePct: 15, minCashPct: 20, drawdownCutPct: -8 };

export const SCAN_CHAINS = new Set(['solana', 'base', 'bsc']);

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

/** Scanner launchpad map. Anything not listed is unknown and never counts as book edge. */
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

export function bookVetoes(input: { equity: number; cashPct: number; drawdownPct: number }): string[] {
  const out: string[] = [];
  if (!(input.equity > 0)) out.push('Book did not load live equity — nothing sizes off an empty book');
  if (input.cashPct < RULES.minCashPct) {
    out.push(`Cash ${input.cashPct.toFixed(0)}% is under the ${RULES.minCashPct}% floor`);
  }
  if (input.drawdownPct <= RULES.drawdownCutPct) {
    out.push(`Drawdown ${input.drawdownPct.toFixed(1)}% is past the ${RULES.drawdownCutPct}% cut — size down`);
  }
  return out;
}

export function bookFromSnapshot(handle: string, snap: PortfolioSnapshot): PlayBook {
  const s = snap.summary;
  const equity = s.totalEquity || 0;
  const cashPct = equity > 0 ? (s.cashUsd / equity) * 100 : 0;
  const drawdownPct = s.currentDrawdownPct || 0;
  return {
    handle,
    equity,
    cashPct,
    drawdownPct,
    vetoes: bookVetoes({ equity, cashPct, drawdownPct }),
    sizeFloorLiq: floorsFor(handle, equity).sizeFloorLiq,
  };
}

export interface EdgeRow {
  label: string;
  openUsd: number;
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
    row = { label, openUsd: 0, realizedUsd: 0, closes: 0, wins: 0, dripPays: 0 };
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
    const rows = [
      ...(p.launchpad ? [bump(launchpads, p.launchpad)] : []),
      ...(p.narratives || []).filter((t) => t !== 'Other').map((t) => bump(themes, t)),
    ];
    for (const row of rows) {
      row.openUsd += p.sizeUsd;
      if (p.dripPays) row.dripPays += 1;
    }
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

function paid(row: EdgeRow): boolean {
  return row.realizedUsd > 0 || row.dripPays > 0;
}

const SOURCE_LABEL: Record<TapeSource, string> = {
  'dex-boost': 'Dex boost',
  'dex-profile': 'Dex profile',
  'gecko-new': 'Gecko new pool',
  'gecko-trending': 'Gecko trending 1h',
};

function usd(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

function edgeLine(row: EdgeRow): string {
  const bits = [`open ${usd(row.openUsd)}`];
  if (row.closes) bits.push(`${row.wins}/${row.closes} wins, realized ${usd(row.realizedUsd)}`);
  if (row.dripPays) bits.push(`${row.dripPays} drip payer${row.dripPays > 1 ? 's' : ''}`);
  return `${row.label}: ${bits.join(', ')}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function scorePlay(input: {
  padRow?: EdgeRow;
  themeRows: EdgeRow[];
  liquidityUsd: number;
  volume1hUsd: number;
  change1hPct: number | null;
  sources: TapeSource[];
  minLiq: number;
}): number {
  let edge = 0;
  if (input.padRow) edge += paid(input.padRow) ? 25 : 12;
  for (const t of input.themeRows) edge += paid(t) ? 15 : 6;
  edge = Math.min(40, edge);
  const liq = clamp01(Math.log10(Math.max(1, input.liquidityUsd / input.minLiq)) / 1.5) * 20;
  const flow = input.liquidityUsd > 0 ? clamp01(input.volume1hUsd / input.liquidityUsd / 0.5) * 20 : 0;
  const chg = input.change1hPct ?? 0;
  const momentum = chg <= 0 ? 0 : chg <= 50 ? (chg / 50) * 10 : chg <= 100 ? 10 : 5;
  const tape = Math.min(10, input.sources.length * 3.4);
  return Math.round(edge + liq + flow + momentum + tape);
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
    const launchpad = scannerLaunchpad(row.dexId, row.mint);
    const themes = narrativesFor({ symbol: row.symbol, name: row.name, quote: row.quoteSymbol }).filter(
      (t) => t !== 'Other',
    );
    const padRow = launchpad ? profile.launchpads.get(launchpad) : undefined;
    const themeRows = themes.map((t) => profile.themes.get(t)).filter((r): r is EdgeRow => Boolean(r));
    if (!padRow && !themeRows.length) continue;

    const cardVetoes: string[] = [];
    if (row.liquidityUsd < floors.sizeFloorLiq) {
      cardVetoes.push(`Liquidity ${usd(row.liquidityUsd)} is under the ${usd(floors.sizeFloorLiq)} size floor`);
    }
    const anyPaid = (padRow && paid(padRow)) || themeRows.some(paid);
    if (!anyPaid) {
      const names = [padRow?.label, ...themeRows.map((r) => r.label)].filter(Boolean).join(' / ');
      cardVetoes.push(`${names} has not paid this book yet (no realized win or drip)`);
    }
    const rawCap = Math.floor(Math.min(nameCap, cashAboveFloor));
    if (!book.vetoes.length && !cardVetoes.length && rawCap <= 0) {
      cardVetoes.push(`No cash above the ${RULES.minCashPct}% floor to size with`);
    }
    const vetoes = [...book.vetoes, ...cardVetoes];
    const decision = vetoes.length ? 'watch' : 'size';
    const sizeCapUsd = decision === 'size' ? rawCap : 0;
    const bookEdge = [padRow, ...themeRows]
      .filter((r): r is EdgeRow => Boolean(r))
      .map(edgeLine)
      .join(' · ');
    const lastCall =
      decision === 'size'
        ? `SIZE_UP_TO_${sizeCapUsd}`
        : book.vetoes.length
          ? 'WAIT_BOOK'
          : row.liquidityUsd < floors.sizeFloorLiq
            ? 'WAIT_LIQ'
            : 'WATCH_EDGE';
    const where = launchpad || 'an unknown launchpad';
    const reason =
      decision === 'size'
        ? `${row.symbol} launched on ${where} overlaps a bucket that has paid this book, and ${usd(row.liquidityUsd)} liquidity clears the ${usd(floors.sizeFloorLiq)} floor.`
        : `Watch only: ${vetoes[0]}.`;

    plays.push({
      account: input.handle,
      mint: row.mint,
      symbol: row.symbol,
      chain: row.chain,
      launchpad: launchpad || 'Unknown',
      themes,
      trigger: row.sources.map((s) => SOURCE_LABEL[s]).join(' + ') || 'tape',
      bookEdge,
      sizeCapUsd,
      vetoes,
      decision,
      lastCall,
      reason,
      score: scorePlay({
        padRow,
        themeRows,
        liquidityUsd: row.liquidityUsd,
        volume1hUsd: row.volume1hUsd,
        change1hPct: row.change1hPct,
        sources: row.sources,
        minLiq: floors.minLiq,
      }),
      liquidityUsd: row.liquidityUsd,
      volume1hUsd: row.volume1hUsd,
      change1hPct: row.change1hPct,
      ageHours: row.ageHours,
      pairUrl: row.pairUrl,
      sources: row.sources,
    });
  }

  plays.sort((a, b) => b.score - a.score || b.liquidityUsd - a.liquidityUsd);
  return { book, plays: plays.slice(0, input.limit ?? 12) };
}

/** Re-apply book vetoes computed from the book on screen (it carries the browser's peak). */
export function applyBookVetoes(plays: Play[], vetoes: string[]): Play[] {
  if (!vetoes.length) return plays;
  return plays.map((p) => {
    const merged = [...vetoes, ...p.vetoes.filter((v) => !vetoes.includes(v))];
    return {
      ...p,
      vetoes: merged,
      decision: 'watch',
      sizeCapUsd: 0,
      lastCall: 'WAIT_BOOK',
      reason: `Watch only: ${merged[0]}.`,
    };
  });
}
