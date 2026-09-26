import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { HeroSlot } from '../../lib/ops/heroes';
import { lastCallForCash, lastCallForPosition } from '../../lib/ops/lastCall';
import { sparklineFromMove } from '../../lib/ops/spark';
import { cn, formatHold, formatPct, formatPrice, formatSignedUsd, formatUsd } from '../../lib/format';

const THEMES = [
  { stroke: '#f5c14a', fill: '#f5c14a', border: 'border-amber-400/25', chip: 'bg-amber-400/15 text-amber-200', text: 'text-amber-200' },
  { stroke: '#7dd3fc', fill: '#38bdf8', border: 'border-sky-400/25', chip: 'bg-sky-400/15 text-sky-200', text: 'text-sky-200' },
  { stroke: '#f472b6', fill: '#ec4899', border: 'border-fuchsia-400/25', chip: 'bg-fuchsia-400/15 text-fuchsia-200', text: 'text-fuchsia-200' },
] as const;

interface Props {
  slot: HeroSlot;
}

export function HeroPositionCard({ slot }: Props) {
  const theme = THEMES[(slot.rank - 1) % THEMES.length];
  const p = slot.position;
  const idle = slot.kind === 'idle';
  const chg = p?.change24hPct;
  const pnl24 = p?.pnl24hUsd;
  const deltaUsd = p ? (p.hasCostBasis ? p.unrealizedPnl : (pnl24 ?? 0)) : 0;
  const deltaPct = p
    ? p.hasCostBasis
      ? p.unrealizedPnlPct
      : (chg ?? 0)
    : slot.equity
      ? (slot.sizeUsd / slot.equity) * 100
      : 0;
  const spark = sparklineFromMove(p?.currentPrice || (idle ? 1 : slot.sizeUsd || 1), p ? chg : 0);
  const chart = spark.map((v, i) => ({ i, v }));
  const call = p
    ? lastCallForPosition(p)
    : idle
      ? { action: 'IDLE', bars: [{ label: 'IDLE', pct: 70 }, { label: 'WAIT', pct: 20 }, { label: 'NO_NAME', pct: 10 }] }
      : lastCallForCash(slot.equity ? (slot.sizeUsd / slot.equity) * 100 : 0);
  const gid = `hero-fill-${slot.rank}-${slot.label}`;
  const up = deltaUsd >= 0;

  return (
    <article
      className={cn(
        'flex min-h-[420px] flex-col rounded-2xl border bg-[#0d0f18] p-4',
        theme.border,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold',
              theme.chip,
            )}
          >
            {slot.label.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{slot.label}</p>
            <p className="text-[11px] text-white/40">{slot.subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', theme.chip)}>
            #{slot.rank}
          </span>
          <p className="mt-1 text-[10px] text-white/40">
            {slot.rank === 1 ? 'leading' : `${formatUsd(slot.behindUsd, true)} behind`}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <p className="font-mono text-3xl font-semibold tracking-tight">
          {idle ? '—' : formatUsd(slot.sizeUsd)}
        </p>
        <p className={cn('mt-0.5 text-sm', idle ? 'text-white/35' : up ? 'text-emerald-400' : 'text-rose-400')}>
          {idle ? 'empty desk' : `${formatSignedUsd(deltaUsd)} `}
          {idle ? null : <span className="text-white/40">({formatPct(deltaPct)})</span>}
        </p>
      </div>

      {p ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
          <p className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={cn('rounded px-1.5 py-0.5 font-semibold uppercase', theme.chip)}>
              Long {p.symbol}
            </span>
            <span className="text-white/50">{formatHold(p.holdTimeHours)}</span>
            <span className="ml-auto font-mono text-white/80">{formatUsd(p.sizeUsd, true)}</span>
          </p>
          <p className="mt-1 font-mono text-[10px] text-white/45">
            {p.hasCostBasis
              ? `entry ${formatPrice(p.entryPrice)} · mark ${formatPrice(p.currentPrice)}`
              : `mark ${formatPrice(p.currentPrice)} · no basis`}
            {p.liquidityUsd ? ` · liq ${formatUsd(p.liquidityUsd, true)}` : ''}
          </p>
        </div>
      ) : (
        <p className={cn('mt-3 text-[11px] font-semibold uppercase tracking-[0.14em]', theme.text)}>
          {idle ? 'No name' : 'Flat · cash'}
        </p>
      )}

      <div className="relative mt-3 h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.stroke} stopOpacity={0.4} />
                <stop offset="100%" stopColor={theme.stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke={theme.stroke}
              strokeWidth={2}
              fill={`url(#${gid})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <span className="absolute right-1 top-1 font-mono text-[10px] text-white/35">
          {p ? formatPrice(spark[spark.length - 1] || 0) : formatUsd(slot.sizeUsd, true)}
        </span>
        <span className="absolute bottom-1 left-1 text-[10px] uppercase tracking-wider text-white/30">
          start
        </span>
      </div>

      <div className="mt-auto space-y-2 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
          Last call
        </p>
        {call.bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-28 truncate font-medium text-white/70">{bar.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{ width: `${bar.pct}%`, background: theme.stroke }}
              />
            </div>
            <span className="w-8 text-right font-mono text-white/45">{bar.pct}%</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-white/10 pt-2 font-mono text-[10px] text-white/40">
          <span>24h {p?.pnl24hUsd != null ? formatSignedUsd(p.pnl24hUsd, true) : '—'}</span>
          <span>vol {p?.volume24hUsd != null ? formatUsd(p.volume24hUsd, true) : '—'}</span>
          <span>{call.action}</span>
        </div>
      </div>
    </article>
  );
}
