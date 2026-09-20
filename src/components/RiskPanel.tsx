import type { Position, PortfolioSummary } from '../types/portfolio';
import { formatUsd, formatPct, cn } from '../lib/format';

interface Props {
  summary: PortfolioSummary;
  positions: Position[];
}

export function RiskPanel({ summary, positions }: Props) {
  const ranked = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd);
  const largest = ranked[0];
  const equity = summary.totalEquity || 1;
  const top3Pct =
    ranked.slice(0, 3).reduce((sum, p) => sum + p.sizeUsd, 0) / equity;

  const cashPct = (summary.cashUsd / equity) * 100;
  const openRiskPct = (summary.openPositionsValue / equity) * 100;

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">
        Risk Snapshot
      </h3>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-white/50">Cash / Dry powder</p>
          <p className="text-lg font-medium">{formatPct(cashPct)} ({formatUsd(summary.cashUsd, true)})</p>
        </div>
        <div>
          <p className="text-white/50">Open exposure</p>
          <p className="text-lg font-medium">{formatPct(openRiskPct)}</p>
        </div>
        <div>
          <p className="text-white/50">Largest position</p>
          <p className="text-lg font-medium">
            {largest ? `${largest.symbol} ${((largest.sizeUsd / equity) * 100).toFixed(1)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-white/50">Top 3 concentration</p>
          <p
            className={cn(
              'text-lg font-medium',
              top3Pct > 0.45 ? 'text-amber-400' : 'text-white'
            )}
          >
            {formatPct(top3Pct * 100)}
          </p>
        </div>
        <div>
          <p className="text-white/50">Current drawdown</p>
          <p className={cn('text-lg font-medium', summary.currentDrawdownPct < -5 ? 'text-rose-400' : 'text-white')}>
            {formatPct(summary.currentDrawdownPct)}
          </p>
        </div>
        <div>
          <p className="text-white/50">Win rate / Profit factor</p>
          <p className="text-lg font-medium">
            {summary.winRate.toFixed(1)}% / {summary.profitFactor.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-black/30 p-3 text-xs text-white/60">
        <p className="font-medium text-white/80">Rules (edit these as you scale)</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Max single position: 12–15% of equity once &gt; $500k</li>
          <li>Keep ≥ 20% cash for new high-conviction entries</li>
          <li>Reduce size after 8%+ drawdown from peak</li>
          <li>Track R-multiple on every closed trade</li>
        </ul>
      </div>
    </div>
  );
}
