import type { PortfolioSnapshot } from '../../types/portfolio.ts';

export type StreamTone = 'long' | 'thesis' | 'alert' | 'close' | 'mark';

export interface DecisionEvent {
  id: string;
  actor: string;
  action: string;
  detail: string;
  tone: StreamTone;
  weight?: number;
}

export function buildDecisionStream(snap: PortfolioSnapshot, limit = 18): DecisionEvent[] {
  const events: DecisionEvent[] = [];
  for (const alert of snap.alerts) {
    events.push({
      id: `alert-${alert.id}`,
      actor: 'RISK',
      action: alert.level.toUpperCase(),
      detail: alert.message,
      tone: 'alert',
    });
  }
  for (const p of snap.openPositions) {
    if (p.thesis) {
      events.push({
        id: `thesis-${p.id}`,
        actor: p.symbol,
        action: 'THESIS',
        detail: p.thesis.replace(/\s+/g, ' ').slice(0, 140),
        tone: 'thesis',
        weight: p.sizeUsd,
      });
    }
    if (p.change24hPct != null && Math.abs(p.change24hPct) >= 8) {
      events.push({
        id: `mark-${p.id}`,
        actor: p.symbol,
        action: p.change24hPct >= 0 ? 'RIDE' : 'FADE',
        detail: `24h ${p.change24hPct >= 0 ? '+' : ''}${p.change24hPct.toFixed(1)}% · mark ${p.currentPrice || '—'}`,
        tone: 'mark',
        weight: Math.abs(p.pnl24hUsd ?? 0),
      });
    }
  }
  for (const t of snap.closedTrades.slice(0, 8)) {
    events.push({
      id: `close-${t.id}`,
      actor: t.symbol,
      action: t.realizedPnl >= 0 ? 'CLOSE_WIN' : 'CLOSE_LOSS',
      detail: `${t.realizedPnl >= 0 ? '+' : ''}${t.realizedPnl.toFixed(0)} USD · ${t.exitDate.slice(0, 10)}`,
      tone: 'close',
      weight: Math.abs(t.realizedPnl),
    });
  }
  const longs = snap.openPositions
    .filter((p) => p.sizeUsd >= 50)
    .slice(0, 6)
    .map((p) => ({
      id: `long-${p.id}`,
      actor: p.symbol,
      action: 'LONG',
      detail: `${p.chain} · ${((p.sizeUsd / (snap.summary.totalEquity || 1)) * 100).toFixed(1)}% book`,
      tone: 'long' as const,
      weight: p.sizeUsd,
    }));
  events.push(...longs);
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  unique.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  return unique.slice(0, limit);
}
