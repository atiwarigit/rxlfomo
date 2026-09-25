import { formatUsd } from '../../lib/format';
import { sizeBoard } from '../../lib/ops/heroes';
import type { PortfolioSnapshot } from '../../types/portfolio';

const BAR = ['bg-fuchsia-400', 'bg-amber-400', 'bg-sky-400', 'bg-violet-400', 'bg-emerald-400', 'bg-white/40'];

export function SizeBoard({ data }: { data: PortfolioSnapshot }) {
  const rows = sizeBoard(data);
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d0f18] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Leaderboard
        </h3>
        <span className="text-[10px] text-white/35">size</span>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-4 text-right font-mono text-white/35">{row.rank}</span>
            <span className="w-16 truncate">{row.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${BAR[i % BAR.length]}`}
                style={{ width: `${row.widthPct}%` }}
              />
            </div>
            <span className="w-14 text-right font-mono text-white/70">{formatUsd(row.sizeUsd, true)}</span>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/35">No open size.</p>
        ) : null}
      </div>
    </section>
  );
}
