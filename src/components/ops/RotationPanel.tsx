import { useMemo, useState } from 'react';
import { Rocket } from 'lucide-react';
import type { PortfolioSnapshot } from '../../types/portfolio';
import { launchpadRotation, narrativeRotation, rotationCall, type RotationRow } from '../../lib/ops/rotation';
import { cn, formatPct, formatSignedUsd, formatUsd } from '../../lib/format';

function tone(v: number | null | undefined) {
  if (v == null || v === 0) return 'text-white/60';
  return v > 0 ? 'text-emerald-400' : 'text-rose-400';
}

const COLLAPSED_ROWS = 10;

function Table({ rows: allRows, total }: { rows: RotationRow[]; total: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!allRows.length) {
    return <p className="py-6 text-center text-xs text-white/40">No tagged names yet.</p>;
  }
  const ranked = [...allRows].sort(
    (a, b) => b.sizeUsd + Math.abs(b.totalPnlUsd) - (a.sizeUsd + Math.abs(a.totalPnlUsd)),
  );
  const visible = new Set(
    (expanded ? ranked : ranked.slice(0, COLLAPSED_ROWS)).map((r) => r.key),
  );
  const rows = allRows.filter((r) => visible.has(r.key));
  const hidden = allRows.length - rows.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-wider text-white/40">
          <tr>
            <th className="py-2 pr-3 font-medium">Bucket</th>
            <th className="py-2 pr-3 text-right font-medium">Open</th>
            <th className="py-2 pr-3 text-right font-medium">% book</th>
            <th className="py-2 pr-3 text-right font-medium">24h move</th>
            <th className="py-2 pr-3 text-right font-medium">Unrealized</th>
            <th className="py-2 pr-3 text-right font-medium">Realized</th>
            <th className="py-2 pr-3 text-right font-medium">Wins</th>
            <th className="py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-white/5">
              <td className="py-2 pr-3">
                <div className="font-medium text-white">{r.label}</div>
                <div className="max-w-[220px] truncate text-[10px] text-white/40">
                  {r.symbols.slice(0, 6).join(' · ')}
                </div>
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {r.openNames ? `${r.openNames} · ${formatUsd(r.sizeUsd, true)}` : '—'}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-white/60">
                {total > 0 && r.sizeUsd > 0 ? `${((r.sizeUsd / total) * 100).toFixed(0)}%` : '—'}
              </td>
              <td className={cn('py-2 pr-3 text-right font-mono', tone(r.move24hPct))}>
                {r.move24hPct == null ? '—' : formatPct(r.move24hPct)}
              </td>
              <td className={cn('py-2 pr-3 text-right font-mono', tone(r.unrealizedUsd))}>
                {r.openNames ? formatSignedUsd(r.unrealizedUsd) : '—'}
              </td>
              <td className={cn('py-2 pr-3 text-right font-mono', tone(r.realizedUsd))}>
                {r.closes ? formatSignedUsd(r.realizedUsd) : '—'}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-white/60">
                {r.closes ? `${r.wins}/${r.closes}` : '—'}
              </td>
              <td className={cn('py-2 text-right font-mono font-semibold', tone(r.totalPnlUsd))}>
                {formatSignedUsd(r.totalPnlUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
        >
          {expanded ? 'Show top buckets' : `Show ${hidden} smaller buckets`}
        </button>
      ) : null}
    </div>
  );
}

export function RotationPanel({ data }: { data: PortfolioSnapshot }) {
  const [view, setView] = useState<'launchpad' | 'narrative'>('launchpad');
  const pads = useMemo(() => launchpadRotation(data), [data]);
  const stories = useMemo(() => narrativeRotation(data), [data]);
  const rows = view === 'launchpad' ? pads : stories;
  const call = rotationCall(rows);
  const total = data.summary.openPositionsValue;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d0f18] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="text-amber-300" />
          <h2 className="font-semibold">Rotation</h2>
          <span className="text-xs text-white/40">
            where your P&L is coming from, by {view}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {call ? (
            <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[11px] text-white/70">
              {call}
            </span>
          ) : null}
          <div className="flex rounded-lg border border-white/10 p-0.5 text-[11px]">
            {(['launchpad', 'narrative'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'rounded-md px-2.5 py-1 capitalize',
                  view === v ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Table rows={rows} total={total} />
      <p className="mt-2 text-[10px] text-white/30">
        Launchpad from GeckoTerminal pool labels (Pons, Bankr, Pump.fun, Stonk.fun…); unlabelled pools
        paired against another token show as “STONK pair”, “wNEAR pair”, etc. Narratives are
        keyword + pairing tags (stock-paired = Stonks). Realized uses the loaded Relay window.
        {view === 'narrative' ? ' A name can sit in more than one narrative.' : ''}
      </p>
    </section>
  );
}
