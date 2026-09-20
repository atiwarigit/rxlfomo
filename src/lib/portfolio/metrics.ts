import type { ClosedTrade, EquityPoint, PortfolioAlert, Position } from '../../types/portfolio.ts';

export interface ClosedStats {
  winRate: number;
  profitFactor: number;
  avgRMultiple: number;
  totalTrades: number;
  realized7d: number | null;
  realized30d: number | null;
}

export function statsFromClosed(trades: ClosedTrade[]): ClosedStats {
  if (!trades.length) {
    return {
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      totalTrades: 0,
      realized7d: null,
      realized30d: null,
    };
  }
  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const rValues = trades.map((t) => {
    if (t.rMultiple != null) return t.rMultiple;
    if (avgLoss > 0) return t.realizedPnl / avgLoss;
    return t.realizedPnl > 0 ? 1 : t.realizedPnl < 0 ? -1 : 0;
  });
  const now = Date.now();
  const inWindow = (days: number) =>
    trades
      .filter((t) => now - Date.parse(t.exitDate) <= days * 86_400_000)
      .reduce((s, t) => s + t.realizedPnl, 0);

  return {
    winRate: (wins.length / trades.length) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    avgRMultiple: rValues.reduce((s, n) => s + n, 0) / rValues.length,
    totalTrades: trades.length,
    realized7d: inWindow(7),
    realized30d: inWindow(30),
  };
}

export function buildEquityCurve(
  closed: ClosedTrade[],
  currentEquity: number,
  realizedAllTime: number,
  unrealized: number,
): EquityPoint[] {
  const starting = currentEquity - realizedAllTime - unrealized;
  const sorted = [...closed].sort(
    (a, b) => Date.parse(a.exitDate) - Date.parse(b.exitDate),
  );
  let cum = 0;
  const points: EquityPoint[] = [];
  if (sorted.length) {
    const firstDay = sorted[0].exitDate.slice(0, 10);
    points.push({ date: firstDay, equity: Math.max(0, starting), realizedPnl: 0 });
  }
  for (const t of sorted) {
    cum += t.realizedPnl;
    points.push({
      date: t.exitDate.slice(0, 10),
      equity: Math.max(0, starting + cum),
      realizedPnl: cum,
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  points.push({
    date: today,
    equity: currentEquity,
    realizedPnl: realizedAllTime,
  });
  const byDay = new Map<string, EquityPoint>();
  for (const p of points) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return ((equity - peak) / peak) * 100;
}

export function buildAlerts(
  equity: number,
  cashUsd: number,
  positions: Position[],
  ddPct: number,
): PortfolioAlert[] {
  const alerts: PortfolioAlert[] = [];
  if (equity <= 0) return alerts;
  const cashPct = (cashUsd / equity) * 100;
  const ranked = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd);
  const largest = ranked[0];
  const top3 = ranked.slice(0, 3).reduce((s, p) => s + p.sizeUsd, 0) / equity;

  if (largest && largest.sizeUsd / equity > 0.15) {
    alerts.push({
      id: 'size-single',
      level: 'warn',
      message: `${largest.symbol} is ${((largest.sizeUsd / equity) * 100).toFixed(1)}% of equity (soft cap 15%).`,
    });
  }
  if (top3 > 0.45) {
    alerts.push({
      id: 'size-top3',
      level: 'warn',
      message: `Top 3 names are ${(top3 * 100).toFixed(0)}% of equity (soft cap 45%).`,
    });
  }
  if (cashPct < 20) {
    alerts.push({
      id: 'cash-floor',
      level: cashPct < 10 ? 'crit' : 'warn',
      message: `Cash is ${cashPct.toFixed(0)}% — below the 20% dry-powder floor.`,
    });
  }
  if (ddPct < -8) {
    alerts.push({
      id: 'drawdown',
      level: ddPct < -15 ? 'crit' : 'warn',
      message: `Drawdown ${ddPct.toFixed(1)}% from peak — size down, no new risk.`,
    });
  }
  const illiquid = ranked.find(
    (p) => p.liquidityUsd != null && p.liquidityUsd > 0 && p.sizeUsd > p.liquidityUsd * 0.1,
  );
  if (illiquid) {
    alerts.push({
      id: 'liquidity',
      level: 'warn',
      message: `${illiquid.symbol} size is >10% of pool liquidity — mark-to-market may not be exit-able.`,
    });
  }
  return alerts;
}
