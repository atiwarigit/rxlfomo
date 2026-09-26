import type { ClosedTrade, PortfolioSnapshot, Position } from '../../types/portfolio.ts';

export interface RotationRow {
  key: string;
  label: string;
  openNames: number;
  sizeUsd: number;
  unrealizedUsd: number;
  pnl24hUsd: number;
  /** Size-weighted 24h move of the names you hold there. */
  move24hPct: number | null;
  realizedUsd: number;
  closes: number;
  wins: number;
  /** Open unrealized + realized: the "is this pad paying me" number. */
  totalPnlUsd: number;
  /** Estimated drip income per day attributed to this bucket. */
  dripPerDayUsd: number;
  symbols: string[];
}

type Keyer = (row: Position | ClosedTrade) => { key: string; label: string }[];

const byLaunchpad: Keyer = (row) => [
  { key: row.launchpadId || 'unknown', label: row.launchpad || 'Unknown' },
];

const STRATEGY_LABEL: Record<string, string> = {
  'drip-pair': 'Drip pairs (held for drip)',
  'drip-reward': 'Drip received',
  trade: 'Active trades',
};

const byStrategy: Keyer = (row) => {
  const key = ('strategy' in row && row.strategy) || 'trade';
  return [{ key, label: STRATEGY_LABEL[key] ?? key }];
};

const byNarrative: Keyer = (row) => {
  const tags = row.narratives?.length ? row.narratives : ['Untagged'];
  return tags.map((t) => ({ key: t, label: t }));
};

function rollup(open: Position[], closed: ClosedTrade[], keyer: Keyer): RotationRow[] {
  const rows = new Map<string, RotationRow & { moveWeight: number; moveSum: number }>();
  const get = (key: string, label: string) => {
    const hit = rows.get(key);
    if (hit) return hit;
    const fresh = {
      key,
      label,
      openNames: 0,
      sizeUsd: 0,
      unrealizedUsd: 0,
      pnl24hUsd: 0,
      move24hPct: null,
      realizedUsd: 0,
      closes: 0,
      wins: 0,
      totalPnlUsd: 0,
      dripPerDayUsd: 0,
      symbols: [] as string[],
      moveWeight: 0,
      moveSum: 0,
    };
    rows.set(key, fresh);
    return fresh;
  };

  for (const p of open) {
    for (const { key, label } of keyer(p)) {
      const r = get(key, label);
      r.openNames += 1;
      r.sizeUsd += p.sizeUsd;
      r.unrealizedUsd += p.hasCostBasis ? p.unrealizedPnl : (p.pnl24hUsd ?? 0);
      r.pnl24hUsd += p.pnl24hUsd ?? 0;
      // Rewards and the pairs paying them report the same drip; count it once, on the pair.
      if (p.strategy !== 'drip-reward') r.dripPerDayUsd += p.dripPerDayUsd ?? 0;
      if (p.change24hPct != null && p.sizeUsd > 0) {
        r.moveSum += p.change24hPct * p.sizeUsd;
        r.moveWeight += p.sizeUsd;
      }
      if (!r.symbols.includes(p.symbol)) r.symbols.push(p.symbol);
    }
  }
  for (const t of closed) {
    for (const { key, label } of keyer(t)) {
      const r = get(key, label);
      r.realizedUsd += t.realizedPnl;
      r.closes += 1;
      if (t.realizedPnl > 0) r.wins += 1;
      if (!r.symbols.includes(t.symbol)) r.symbols.push(t.symbol);
    }
  }

  return [...rows.values()]
    .map(({ moveWeight, moveSum, ...r }) => ({
      ...r,
      move24hPct: moveWeight > 0 ? moveSum / moveWeight : null,
      totalPnlUsd: r.unrealizedUsd + r.realizedUsd,
    }))
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
}

export function launchpadRotation(snap: PortfolioSnapshot): RotationRow[] {
  return rollup(snap.openPositions, snap.closedTrades, byLaunchpad);
}

export function strategyRotation(snap: PortfolioSnapshot): RotationRow[] {
  return rollup(snap.openPositions, [], byStrategy);
}

export function narrativeRotation(snap: PortfolioSnapshot): RotationRow[] {
  return rollup(snap.openPositions, snap.closedTrades, byNarrative);
}

/** One-line read of where the heat is, for the header / chat. */
export function rotationCall(rows: RotationRow[]): string | null {
  const scored = rows.filter((r) => r.move24hPct != null && r.sizeUsd >= 10);
  if (!scored.length) return null;
  const hot = [...scored].sort((a, b) => (b.move24hPct ?? 0) - (a.move24hPct ?? 0))[0];
  const cold = [...scored].sort((a, b) => (a.move24hPct ?? 0) - (b.move24hPct ?? 0))[0];
  if (hot.key === cold.key) return `${hot.label} ${fmt(hot.move24hPct)} 24h`;
  return `Heat: ${hot.label} ${fmt(hot.move24hPct)} · Cold: ${cold.label} ${fmt(cold.move24hPct)}`;
}

function fmt(v: number | null) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
