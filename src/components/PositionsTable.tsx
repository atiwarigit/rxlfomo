import type { Position } from '../types/portfolio';
import { formatUsd, formatPct, formatMcap, cn } from '../lib/format';

interface Props {
  positions: Position[];
  totalEquity: number;
}

export function PositionsTable({ positions, totalEquity }: Props) {
  const sorted = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd);
  const equity = totalEquity || 1;

  if (!sorted.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-white/50">
        No open risk positions. Cash and dust under $5 are kept off this table.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
          <tr>
            <th className="px-4 py-3">Token</th>
            <th className="px-4 py-3 text-right">Size</th>
            <th className="px-4 py-3 text-right">% Port</th>
            <th className="px-4 py-3 text-right">Unrealized</th>
            <th className="px-4 py-3 text-right">Entry → Now</th>
            <th className="px-4 py-3 text-right">Liq</th>
            <th className="px-4 py-3 text-right">Hold</th>
            <th className="px-4 py-3">Chain</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sorted.map((p) => {
            const pctOfPort = (p.sizeUsd / equity) * 100;
            const isProfit = p.unrealizedPnl >= 0;
            return (
              <tr key={p.id} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{p.symbol}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/40">
                      {p.source}
                    </span>
                  </div>
                  {p.thesis && (
                    <div className="mt-0.5 max-w-[220px] truncate text-xs text-white/40">
                      {p.thesis}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatUsd(p.sizeUsd)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={cn(pctOfPort > 15 ? 'text-amber-400' : 'text-white/70')}>
                    {pctOfPort.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className={cn(isProfit ? 'text-emerald-400' : 'text-rose-400')}>
                    {formatUsd(p.unrealizedPnl)}
                  </div>
                  <div className="text-xs text-white/40">{formatPct(p.unrealizedPnlPct)}</div>
                </td>
                <td className="px-4 py-3 text-right text-xs text-white/60">
                  {p.entryMcap || p.currentMcap
                    ? `${formatMcap(p.entryMcap)} → ${formatMcap(p.currentMcap)}`
                    : `${p.entryPrice ? p.entryPrice.toPrecision(3) : '—'} → ${p.currentPrice ? p.currentPrice.toPrecision(3) : '—'}`}
                </td>
                <td className="px-4 py-3 text-right text-xs text-white/50">
                  {p.liquidityUsd ? formatMcap(p.liquidityUsd) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-white/60">
                  {p.holdTimeHours <= 0
                    ? '—'
                    : p.holdTimeHours < 24
                      ? `${p.holdTimeHours.toFixed(0)}h`
                      : `${(p.holdTimeHours / 24).toFixed(1)}d`}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs capitalize">
                    {p.chain}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
