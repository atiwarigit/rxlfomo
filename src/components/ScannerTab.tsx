import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Radar, RefreshCw, ShieldAlert } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { ChatTurn, ScannerChatSnapshot } from '../lib/ai/bookContext';
import { cn, formatPct } from '../lib/format';
import {
  CAPS,
  CATEGORIES,
  ageLabel,
  capBand,
  categoryOf,
  matchesFilters,
  money,
  type CapFilter,
  type Category,
} from '../lib/scanner/cardFormat';
import { applyBook, vetoSentence } from '../lib/scanner/rules';
import type { PortfolioSnapshot } from '../types/portfolio';
import type { Play, PlaysResponse } from '../types/plays';

const PROMPTS = [
  'Which of these overlap a launchpad that has paid this book?',
  'Why is nothing a size?',
  'What would have to change for a size card?',
];

const MAX_CARDS = 12;
const TAPE_MS = 20_000;
const lastPlays = new Map<string, PlaysResponse>();

interface Props {
  handle: string;
  portfolio: PortfolioSnapshot | null;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  hasServerKey: boolean;
  onAttach: () => void;
  thread: ChatTurn[];
  onThread: (turns: ChatTurn[]) => void;
}

async function fetchPlays(handle: string): Promise<PlaysResponse> {
  const res = await fetch(`/api/plays?${new URLSearchParams({ handle }).toString()}`);
  const text = await res.text();
  let body: (PlaysResponse & { message?: string }) | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').slice(0, 180) || `HTTP ${res.status}`);
  }
  if (!res.ok || !body) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}

function oneHourTone(v: number | null): string {
  if (v == null) return 'text-white/50';
  if (v < 0) return 'text-rose-400';
  if (v > 80) return 'text-amber-300';
  if (v >= 8 && v <= 45) return 'text-emerald-400';
  return 'text-white/80';
}

const LABEL_TONE: Record<Play['runnerLabel'], string> = {
  early: 'bg-emerald-400/15 text-emerald-300',
  building: 'bg-sky-400/15 text-sky-300',
  chase: 'bg-amber-400/15 text-amber-300',
};

function Figure({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className={cn('font-mono text-[16px] leading-tight', tone)}>{value}</p>
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/75">
      {children}
    </span>
  );
}

function Social({ href, label }: { href?: string; label: string }) {
  const box =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 font-mono text-[11px]';
  if (!href) {
    return (
      <span className={cn(box, 'opacity-30')} aria-label={`${label} missing`}>
        {label}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(box, 'hover:bg-white/10')} aria-label={label}>
      {label}
    </a>
  );
}

function PlayCard({ play, isNew }: { play: Play; isNew: boolean }) {
  const [copied, setCopied] = useState(false);
  const txns = (play.buys1h ?? 0) + (play.sells1h ?? 0);
  const share = txns ? Math.round(((play.buys1h ?? 0) / txns) * 100) : null;
  const m5 = play.change5mPct;
  const cap = capBand(play.marketCapUsd);
  const meta = [ageLabel(play.ageHours), play.launchpad !== 'Unknown' ? play.launchpad : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-[#0d0f18] p-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <h3 className="truncate font-mono text-[18px] font-[650] leading-tight">{play.symbol}</h3>
        {isNew ? (
          <span className="shrink-0 rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
            NEW
          </span>
        ) : null}
        <Chip>{categoryOf(play)}</Chip>
        <Chip>{cap.label}</Chip>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
            LABEL_TONE[play.runnerLabel],
          )}
        >
          {play.runnerLabel} {play.runnerScore}
        </span>
      </div>
      <p className="-mt-1 text-[13px] text-white/50">{meta}</p>

      <div className="grid grid-cols-3 gap-1.5">
        <Figure
          label="5m"
          value={m5 == null ? '—' : formatPct(m5)}
          tone={m5 == null ? 'text-white/50' : m5 < 0 ? 'text-rose-400' : 'text-white/80'}
        />
        <Figure
          label="1h"
          value={play.change1hPct == null ? '—' : formatPct(play.change1hPct)}
          tone={oneHourTone(play.change1hPct)}
        />
        <Figure
          label="buys"
          value={share == null ? '—' : `${share}%`}
          tone={share == null ? 'text-white/50' : share >= 58 ? 'text-emerald-400' : share < 45 ? 'text-rose-400' : 'text-white/80'}
        />
      </div>

      <p className="font-mono text-[12px] text-white/70">
        Liq {money(play.liquidityUsd)} · 1h vol {money(play.volume1hUsd)}
        {txns ? <span className="text-white/35"> · {txns} txns</span> : null}
      </p>

      <p className={cn('text-[12px]', play.bookFit === 'fits' ? 'text-sky-200/80' : 'text-white/40')}>
        {play.bookEdge}
        {play.decision === 'size' ? (
          <span className="text-emerald-300"> · size ≤ {money(play.sizeCapUsd)}</span>
        ) : null}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          type="button"
          title={copied ? 'Copied' : `Copy ${play.mint}`}
          className="rounded-lg border border-white/15 px-2 py-1 font-mono text-[13px] hover:bg-white/10"
          onClick={() => {
            void navigator.clipboard?.writeText(play.mint).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? 'copied' : `${play.mint.slice(0, 4)}…${play.mint.slice(-4)}`}
        </button>
        <Social href={play.website} label="web" />
        <Social href={play.twitter} label="X" />
        <Social href={play.telegram} label="tg" />
        <a
          href={play.pairUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
        >
          Pair <ExternalLink size={11} />
        </a>
      </div>
    </article>
  );
}

function FilterRow<T extends string>({
  options,
  value,
  counts,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  counts: Record<string, number>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px]',
            value === o
              ? 'border-amber-300/60 bg-amber-300/10 text-amber-200'
              : 'border-white/10 text-white/55 hover:bg-white/5 hover:text-white',
          )}
        >
          {o}
          <span className="ml-1 font-mono text-white/35">{counts[o] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

export function ScannerTab({
  handle,
  portfolio,
  llmApiKey,
  llmModel,
  llmBaseUrl,
  hasServerKey,
  onAttach,
  thread,
  onThread,
}: Props) {
  const key = handle.trim().toLowerCase();
  const [body, setBody] = useState<PlaysResponse | null>(() => lastPlays.get(key) ?? null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('All');
  const [capFilter, setCapFilter] = useState<CapFilter>('All caps');
  const [tickAt, setTickAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [nonce, setNonce] = useState(0);
  const [diff, setDiff] = useState<{ added: Set<string>; removed: number } | null>(null);
  const handleRef = useRef(key);
  const prevMints = useRef<Set<string> | null>(null);

  useEffect(() => {
    handleRef.current = key;
    const cached = lastPlays.get(key) ?? null;
    setBody(cached);
    setDiff(null);
    prevMints.current = cached ? new Set(cached.plays.map((p) => p.mint)) : null;
  }, [key]);

  const loadPlays = useCallback(async () => {
    const forKey = key;
    if (!handle) return;
    setInFlight(true);
    try {
      const next = await fetchPlays(handle);
      if (handleRef.current !== forKey) return;
      const mints = new Set(next.plays.map((p) => p.mint));
      const prev = prevMints.current;
      if (prev) {
        setDiff({
          added: new Set([...mints].filter((m) => !prev.has(m))),
          removed: [...prev].filter((m) => !mints.has(m)).length,
        });
      }
      prevMints.current = mints;
      lastPlays.set(forKey, next);
      setBody(next);
      setError(null);
    } catch (err) {
      if (handleRef.current === forKey) setError(err instanceof Error ? err.message : 'Scanner failed');
    } finally {
      setInFlight(false);
    }
  }, [handle, key]);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    async function tick() {
      if (stopped || busy) return;
      busy = true;
      setTickAt(Date.now());
      try {
        await loadPlays();
      } finally {
        busy = false;
      }
    }
    void tick();
    const id = setInterval(() => void tick(), TAPE_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, nonce]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const { book, plays } = useMemo(() => {
    const runners = (body?.plays ?? []).filter((p, i, all) => all.findIndex((q) => q.mint === p.mint) === i);
    return applyBook(handle, portfolio, runners);
  }, [body, handle, portfolio]);
  const vetoes = book.vetoes;

  const shown = useMemo(
    () => plays.filter((p) => matchesFilters(p, category, capFilter)),
    [plays, category, capFilter],
  );
  const categoryCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of CATEGORIES) out[c] = plays.filter((p) => matchesFilters(p, c, capFilter)).length;
    return out;
  }, [plays, capFilter]);
  const capCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of CAPS) out[c] = plays.filter((p) => matchesFilters(p, category, c)).length;
    return out;
  }, [plays, category]);
  const sizeN = vetoes.length ? 0 : plays.filter((p) => p.decision === 'size').length;
  const watchN = plays.length - sizeN;
  const secs = Math.max(0, Math.floor((now - tickAt) / 1000));
  const unchanged = diff != null && diff.added.size === 0 && diff.removed === 0;

  const chatSnapshot = useMemo<ScannerChatSnapshot>(
    () => ({ book: portfolio, plays, books: [book], tapeCount: body?.tapeCount }),
    [portfolio, plays, book, body],
  );

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-white/10 bg-[#0b0f19] p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Radar size={15} className="text-amber-300" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Scanner · @{handle || '—'}
            </span>
          </div>
          <span className="font-mono text-xs text-white/70">
            rows <span className="text-white">{body?.tapeCount ?? '—'}</span>
          </span>
          <span className="font-mono text-xs text-amber-300">watch {watchN}</span>
          <span className="font-mono text-xs text-emerald-300">size {sizeN}</span>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            disabled={!handle}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={inFlight ? 'animate-spin' : ''} />
            Refresh tape
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-white/10 pt-2">
          <span className="shrink-0 font-mono text-xs text-white/60" aria-live="polite">
            tape {secs}s
            {unchanged ? (
              <span className="text-amber-300"> · tape unchanged</span>
            ) : diff ? (
              <span className="text-white/40">
                {' '}
                · +{diff.added.size} new · −{diff.removed} gone
              </span>
            ) : null}
          </span>
          {vetoes.length ? (
            <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-rose-200/90">
              <ShieldAlert size={12} className="mt-0.5 shrink-0 text-rose-300" />
              {vetoSentence(vetoes)}
            </p>
          ) : (
            <p className="flex-1 text-xs text-white/40">No book veto — a size card carries a cap, not an order.</p>
          )}
        </div>
        {body ? (
          <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
            <FilterRow<Category>
              label="Category"
              options={CATEGORIES}
              value={category}
              counts={categoryCounts}
              onChange={setCategory}
            />
            <FilterRow<CapFilter> label="Market cap" options={CAPS} value={capFilter} counts={capCounts} onChange={setCapFilter} />
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!body ? (
        <p className="py-10 text-center text-sm text-white/40">Reading the live tape…</p>
      ) : !plays.length ? (
        <p className="rounded-2xl border border-white/10 bg-[#0b0f19] py-10 text-center text-sm text-white/45">
          No pool under 48h scores 30+ as a runner above this book's liquidity floor right now.
        </p>
      ) : !shown.length ? (
        <p className="rounded-2xl border border-white/10 bg-[#0b0f19] py-10 text-center text-sm text-white/45">
          No card matches {category} · {capFilter}.
        </p>
      ) : (
        <section className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shown.slice(0, MAX_CARDS).map((p) => (
            <PlayCard key={`${p.chain}:${p.mint}`} play={p} isNew={Boolean(diff?.added.has(p.mint))} />
          ))}
        </section>
      )}

      <ChatPanel
        snapshot={chatSnapshot}
        prompts={PROMPTS}
        thread={thread}
        onThread={onThread}
        llmApiKey={llmApiKey}
        llmModel={llmModel}
        llmBaseUrl={llmBaseUrl}
        hasServerKey={hasServerKey}
        onAttach={onAttach}
      />
    </div>
  );
}
