import { formatPct, formatUsd } from '../../lib/format';
import { tapeRows } from '../../lib/ops/heroes';
import type { PortfolioSnapshot } from '../../types/portfolio';

export function TapeBar({ data }: { data: PortfolioSnapshot }) {
  const rows = tapeRows(data);
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-[#0d0f18] px-3 py-2 font-mono text-[11px]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
        Tape
      </span>
      {rows.map((r) => (
        <span key={r.id} className="flex items-baseline gap-1.5">
          <span className="text-white/70">{r.symbol}</span>
          <span className={r.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {formatPct(r.change24hPct)}
          </span>
          <span className="text-white/30">{formatUsd(r.sizeUsd, true)}</span>
        </span>
      ))}
    </div>
  );
}
