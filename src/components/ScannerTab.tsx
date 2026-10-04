import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Radar, RefreshCw, ShieldAlert } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { ChatTurn, ScannerChatSnapshot } from '../lib/ai/bookContext';
import { cn, formatPct, formatUsd } from '../lib/format';
import { applyBookVetoes, bookNumbers, bookVetoes, vetoSentence } from '../lib/scanner/rules';
import type { PortfolioSnapshot } from '../types/portfolio';
import type { Play, PlaysResponse } from '../types/plays';

const PROMPTS = [
  'Which of these overlap a launchpad that has paid this book?',
  'Why is nothing a size?',
  'What would have to change for a size card?',
];

const MAX_CARDS = 8;
const CLIENT_TTL_MS = 45_000;
const lastPlays = new Map<string, { at: number; body: PlaysResponse }>();

interface Props {
  handle: string;
  portfolio: PortfolioSnapshot | null;
  walletHints: { solana?: string; evm?: string };
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  hasServerKey: boolean;
  onAttach: () => void;
  thread: ChatTurn[];
  onThread: (turns: ChatTurn[]) => void;
}

async function fetchPlays(handle: string, hints: Props['walletHints']): Promise<PlaysResponse> {
  const params = new URLSearchParams({ handle });
  if (hints.solana) params.set('solanaHint', hints.solana);
  if (hints.evm) params.set('evmHint', hints.evm);
  const res = await fetch(`/api/plays?${params.toString()}`);
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

function formatAge(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return 'launch time missing';
  if (hours < 1) return `launched ${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `launched ${hours.toFixed(0)}h ago`;
  return `launched ${Math.round(hours / 24)}d ago`;
}

function capLine(play: Play): string {
  if (play.marketCapUsd == null) return 'mcap missing';
  const mcap = `${formatUsd(play.marketCapUsd, true)} mcap`;
  return play.fdvUsd != null && play.fdvUsd > play.marketCapUsd * 2
    ? `${mcap} · ${formatUsd(play.fdvUsd, true)} FDV`
    : mcap;
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
    <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1">
      <p className="text-[9px] uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className={cn('font-mono text-sm', tone)}>{value}</p>
    </div>
  );
}

function PlayCard({ play }: { play: Play }) {
  const txns = (play.buys1h ?? 0) + (play.sells1h ?? 0);
  const share = txns ? Math.round(((play.buys1h ?? 0) / txns) * 100) : null;
  const meta = [
    capLine(play),
    formatAge(play.ageHours),
    play.launchpad !== 'Unknown' ? play.launchpad : null,
    play.themes[0]?.split(' / ')[0] ?? null,
  ].filter(Boolean);
  const m5 = play.change5mPct;
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0d0f18] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-mono text-base font-semibold">{play.symbol}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {play.decision === 'size' ? (
            <span className="font-mono text-[10px] text-emerald-300">size ≤ {formatUsd(play.sizeCapUsd, true)}</span>
          ) : null}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
              LABEL_TONE[play.runnerLabel],
            )}
          >
            {play.runnerLabel} {play.runnerScore}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-white/55">{meta.join(' · ')}</p>

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

      <p className="font-mono text-[11px] text-white/70">
        Liq {formatUsd(play.liquidityUsd, true)} · 1h vol {formatUsd(play.volume1hUsd, true)}
        {txns ? <span className="text-white/35"> · {txns} txns</span> : null}
      </p>

      <p className={cn('text-[11px]', play.bookFit === 'fits' ? 'text-sky-200/80' : 'text-white/40')}>
        {play.bookEdge}
      </p>

      <a
        href={play.pairUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-auto inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
      >
        Pair <ExternalLink size={11} />
      </a>
    </article>
  );
}

export function ScannerTab({
  handle,
  portfolio,
  walletHints,
  llmApiKey,
  llmModel,
  llmBaseUrl,
  hasServerKey,
  onAttach,
  thread,
  onThread,
}: Props) {
  const key = handle.trim().toLowerCase();
  const [body, setBody] = useState<PlaysResponse | null>(() => lastPlays.get(key)?.body ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!handle) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPlays(handle, walletHints);
      lastPlays.set(key, { at: Date.now(), body: next });
      setBody(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scanner failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, key, walletHints.solana, walletHints.evm]);

  useEffect(() => {
    const hit = lastPlays.get(key);
    setBody(hit?.body ?? null);
    if (!hit || Date.now() - hit.at > CLIENT_TTL_MS) void load();
  }, [key, load]);

  const serverBook = body?.books.find((b) => b.handle.toLowerCase() === key);

  const vetoes = useMemo(() => {
    const onScreen = portfolio ? bookVetoes(bookNumbers(portfolio)) : [];
    const fromRoute = serverBook?.vetoes ?? [];
    const merged = [...onScreen];
    for (const v of fromRoute) {
      const kind = v.split(' ')[0];
      if (!merged.some((m) => m.split(' ')[0] === kind)) merged.push(v);
    }
    return merged;
  }, [portfolio, serverBook]);

  const plays = useMemo(
    () =>
      applyBookVetoes(
        (body?.plays ?? []).filter(
          (p, i, all) =>
            p.account.toLowerCase() === key && all.findIndex((q) => q.mint === p.mint) === i,
        ),
        vetoes,
        serverBook?.vetoes,
      ),
    [body, key, vetoes, serverBook],
  );
  const sizeN = vetoes.length ? 0 : plays.filter((p) => p.decision === 'size').length;
  const watchN = plays.length - sizeN;

  const chatSnapshot = useMemo<ScannerChatSnapshot>(
    () => ({
      book: portfolio,
      plays,
      books: serverBook ? [{ ...serverBook, vetoes }] : [],
      tapeCount: body?.tapeCount,
    }),
    [portfolio, plays, serverBook, vetoes, body],
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
            tape <span className="text-white">{body?.tapeCount ?? '—'}</span>
          </span>
          <span className="font-mono text-xs text-amber-300">watch {watchN}</span>
          <span className="font-mono text-xs text-emerald-300">size {sizeN}</span>
          {body ? (
            <span className="text-[10px] text-white/35">
              {new Date(body.generatedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !handle}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh tape
          </button>
        </div>
        {vetoes.length ? (
          <p className="mt-2 flex items-start gap-1.5 border-t border-white/10 pt-2 text-xs text-rose-200/90">
            <ShieldAlert size={12} className="mt-0.5 shrink-0 text-rose-300" />
            {vetoSentence(vetoes)}
          </p>
        ) : body ? (
          <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/40">
            No book veto — a size card carries a cap, not an order.
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!body && loading ? (
        <p className="py-10 text-center text-sm text-white/40">Reading the tape against @{handle}'s book…</p>
      ) : body && !plays.length ? (
        <p className="rounded-2xl border border-white/10 bg-[#0b0f19] py-10 text-center text-sm text-white/45">
          No pool under 48h scores 30+ as a runner above this book's liquidity floor right now.
        </p>
      ) : (
        <section className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plays.slice(0, MAX_CARDS).map((p) => (
            <PlayCard key={`${p.chain}:${p.mint}`} play={p} />
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
