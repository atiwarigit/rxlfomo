import type { PortfolioSnapshot, Position } from '../../types/portfolio.ts';

export interface HeroSlot {
  rank: number;
  kind: 'position' | 'cash' | 'idle';
  position?: Position;
  sizeUsd: number;
  equity: number;
  behindUsd: number;
  label: string;
  subtitle: string;
}

export function heroSlots(snap: PortfolioSnapshot, n = 3): HeroSlot[] {
  const equity = snap.summary.totalEquity;
  const ranked = [...snap.openPositions].sort((a, b) => b.sizeUsd - a.sizeUsd);
  const raw: Omit<HeroSlot, 'rank' | 'behindUsd'>[] = ranked.slice(0, n).map((position) => ({
    kind: 'position',
    position,
    sizeUsd: position.sizeUsd,
    equity,
    label: position.symbol,
    subtitle:
      [position.launchpad, position.narratives?.find((n) => n !== 'Other')].filter(Boolean).join(' · ') ||
      (position.token && position.token !== position.symbol ? position.token : position.chain),
  }));
  if (raw.length < n) {
    raw.push({
      kind: 'cash',
      sizeUsd: snap.summary.cashUsd,
      equity,
      label: 'CASH',
      subtitle: 'dry powder',
    });
  }
  while (raw.length < n) {
    raw.push({
      kind: 'idle',
      sizeUsd: 0,
      equity,
      label: 'IDLE',
      subtitle: 'no name',
    });
  }
  const lead = raw[0]?.sizeUsd ?? 0;
  return raw.slice(0, n).map((row, i) => ({
    ...row,
    rank: i + 1,
    behindUsd: Math.max(0, lead - row.sizeUsd),
  }));
}

export function sizeBoard(snap: PortfolioSnapshot, limit = 6) {
  const cash = snap.summary.cashUsd;
  const rows = [
    ...[...snap.openPositions]
      .sort((a, b) => b.sizeUsd - a.sizeUsd)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        label: p.symbol,
        sizeUsd: p.sizeUsd,
        tone: (p.change24hPct ?? 0) >= 0 ? ('up' as const) : ('down' as const),
      })),
  ];
  if (cash > 0 && rows.length < limit) {
    rows.push({ id: 'cash', label: 'CASH', sizeUsd: cash, tone: 'up' as const });
  }
  const max = Math.max(...rows.map((r) => r.sizeUsd), 1);
  return rows.map((r, i) => ({ ...r, rank: i + 1, widthPct: (r.sizeUsd / max) * 100 }));
}

export function tapeRows(snap: PortfolioSnapshot, limit = 6) {
  return [...snap.openPositions]
    .filter((p) => p.change24hPct != null)
    .sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      symbol: p.symbol,
      change24hPct: p.change24hPct ?? 0,
      sizeUsd: p.sizeUsd,
    }));
}
