import type { ClosedTrade } from '../types/portfolio';
import { formatUsd, formatPct, cn } from '../lib/format';

interface Props {
  trades: ClosedTrade[];
  captured: number;
  totalOnFomo: number;
}

export function ClosedTradesTable({ trades, captured, totalOnFomo }: Props) {
  if (!trades.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/50">
        No closed trades in this pull. FOMO has not indexed this handle's exits yet — open marks still come from the wallet, Relay, and spotlight.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-white/40">
        Showing {captured} captured closes
        {totalOnFomo > captured ? ` of ${totalOnFomo} FOMO-reported trades` : ''}. Full history is not enumerable from FOMO; wallets stay the source of truth.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-4 py-3">Token</th>
              <th className="px-4 py-3 text-right">Size</th>
              <th className="px-4 py-3 text-right">Realized</th>
              <th className="px-4 py-3 text-right">R</th>
              <th className="px-4 py-3 text-right">Hold</th>
              <th className="px-4 py-3">Exited</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {trades.slice(0, 40).map((t) => {
              const win = t.realizedPnl >= 0;
              return (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">{t.symbol}</td>
                  <td className="px-4 py-3 text-right">{formatUsd(t.sizeUsd)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className={cn(win ? 'text-emerald-400' : 'text-rose-400')}>
                      {formatUsd(t.realizedPnl)}
                    </div>
                    <div className="text-xs text-white/40">{formatPct(t.realizedPnlPct)}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-white/70">
                    {t.rMultiple != null ? t.rMultiple.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-white/60">
                    {t.holdTimeHours < 24
                      ? `${t.holdTimeHours.toFixed(0)}h`
                      : `${(t.holdTimeHours / 24).toFixed(1)}d`}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {t.exitDate.slice(0, 10)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
