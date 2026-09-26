import { useState } from 'react';
import { RefreshCw, Settings2 } from 'lucide-react';
import type { PortfolioSnapshot } from '../../types/portfolio';
import { formatPct, formatSignedUsd, formatUsd } from '../../lib/format';
import { LiveClock } from './LiveClock';

interface Props {
  data: PortfolioSnapshot | null;
  decisions: number;
  sourceLabel: string;
  loading: boolean;
  handle: string;
  handles: string[];
  onSwitch: (handle: string) => void;
  onRefresh: () => void;
  onSources: () => void;
}

function HandleSwitcher({
  handle,
  handles,
  onSwitch,
}: {
  handle: string;
  handles: string[];
  onSwitch: (handle: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const others = handles.filter((h) => h.toLowerCase() !== handle.toLowerCase());
  return (
    <form
      className="mt-1 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onSwitch(draft);
        setDraft('');
      }}
    >
      {others.slice(0, 4).map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onSwitch(h)}
          className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/5 hover:text-white"
        >
          @{h}
        </button>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="@handle ↵"
        aria-label="Switch FOMO handle"
        className="w-24 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] outline-none focus:border-amber-400/60"
      />
    </form>
  );
}

function Cell({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="min-w-[110px] border-l border-white/10 px-4 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p
        className={
          tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-white'
        }
      >
        <span className="font-mono text-lg font-semibold tracking-tight">{value}</span>
      </p>
      {sub ? <p className="text-[10px] text-white/40">{sub}</p> : null}
    </div>
  );
}

export function HeaderStrip({
  data,
  decisions,
  sourceLabel,
  loading,
  handle,
  handles,
  onSwitch,
  onRefresh,
  onSources,
}: Props) {
  const s = data?.summary;
  const pnl24 = data?.pnlWindows.h24;
  const cashPct = s && s.totalEquity ? (s.cashUsd / s.totalEquity) * 100 : 0;
  const openN = data?.openPositions.length ?? 0;

  return (
    <header className="border-b border-white/10 bg-[#0a0b12]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="pr-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">rxlfomo</h1>
            <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              {data?.source.fomo ? 'FOMO' : 'WALLET'}
            </span>
          </div>
          <p className="text-[11px] text-white/45">
            {data?.handle ? `@${data.handle}` : 'ops floor'}
            {data?.displayName ? ` · ${data.displayName}` : ''}
            {' · '}
            {sourceLabel}
          </p>
          <HandleSwitcher handle={handle} handles={handles} onSwitch={onSwitch} />
        </div>

        <Cell
          label="Total P&L 24h"
          value={pnl24 == null ? '—' : formatSignedUsd(pnl24)}
          sub={openN ? `${openN} open names` : 'Dex / Relay marks'}
          tone={pnl24 == null ? 'neutral' : pnl24 >= 0 ? 'up' : 'down'}
        />
        <Cell
          label="Unrealized"
          value={s ? formatSignedUsd(s.unrealizedPnl) : '—'}
          sub={
            data?.openPositions.some((p) => p.hasCostBasis) ? 'basis where known' : '24h mark'
          }
          tone={!s ? 'neutral' : s.unrealizedPnl >= 0 ? 'up' : 'down'}
        />
        <Cell
          label="Volume"
          value={s?.volumeUsd == null ? '—' : formatUsd(s.volumeUsd, true)}
          sub={`${s?.totalTrades ?? 0} FOMO trades`}
        />
        <Cell
          label="Cash"
          value={s ? formatUsd(s.cashUsd, true) : '—'}
          sub={`${cashPct.toFixed(0)}% of equity`}
          tone={s && s.totalEquity > 0 && cashPct < 20 ? 'down' : 'neutral'}
        />
        <Cell
          label="Open risk"
          value={s ? formatUsd(s.openPositionsValue, true) : '—'}
          sub={s ? `eq ${formatUsd(s.totalEquity, true)}` : undefined}
        />
        <Cell
          label="Drawdown"
          value={s ? formatPct(s.currentDrawdownPct) : '—'}
          sub={s ? `peak ${formatUsd(s.peakEquity, true)}` : undefined}
          tone={s && s.currentDrawdownPct < -5 ? 'down' : 'neutral'}
        />
        <Cell label="Decisions" value={String(decisions)} sub="stream + alerts + closes" />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <LiveClock />
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
            {data?.source.onchain ? 'wallet marked' : 'no wallet'}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={onSources}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
          >
            <Settings2 size={13} />
            Sources
          </button>
        </div>
      </div>
    </header>
  );
}
