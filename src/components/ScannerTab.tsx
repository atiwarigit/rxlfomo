import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Radar, RefreshCw, ShieldAlert } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { ChatTurn, ScannerChatSnapshot } from '../lib/ai/bookContext';
import { cn, formatPct, formatUsd } from '../lib/format';
import { applyBookVetoes, bookVetoes } from '../lib/scanner/rules';
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
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(0)}h`;
  return `${Math.round(hours / 24)}d`;
}

function PlayCard({ play, bookVetoed }: { play: Play; bookVetoed: boolean }) {
  const size = play.decision === 'size';
  const chg = play.change1hPct;
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0d0f18] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-base font-semibold">{play.symbol}</h3>
          <p className="truncate text-[11px] text-white/45">
            {play.launchpad} · {play.chain}
            {play.themes.length ? ` · ${play.themes.join(' / ')}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            size ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300',
          )}
        >
          {play.decision}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-white/40">Trigger</dt>
        <dd className="truncate text-right text-white/80" title={play.trigger}>
          {play.trigger}
        </dd>
        <dt className="text-white/40">Liquidity</dt>
        <dd className="text-right font-mono text-white/80">{formatUsd(play.liquidityUsd, true)}</dd>
        <dt className="text-white/40">1h</dt>
        <dd
          className={cn(
            'text-right font-mono',
            chg == null ? 'text-white/50' : chg >= 0 ? 'text-emerald-400' : 'text-rose-400',
          )}
        >
          {chg == null ? '—' : formatPct(chg)}
        </dd>
        <dt className="text-white/40">Age</dt>
        <dd className="text-right font-mono text-white/80">
          {formatAge(play.ageHours)}
        </dd>
      </dl>

      <p className="text-[12px] leading-snug text-white/75">{play.reason}</p>
      {play.bookEdge ? (
        <p className="text-[11px] leading-snug text-sky-200/70">Book edge · {play.bookEdge}</p>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
        <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Size cap</p>
        <p className={cn('font-mono text-sm', play.sizeCapUsd > 0 ? 'text-emerald-300' : 'text-white/60')}>
          {play.sizeCapUsd > 0
            ? `≤ ${formatUsd(play.sizeCapUsd)}`
            : `$0 — ${bookVetoed ? 'book veto' : 'card veto'}`}
        </p>
      </div>

      {play.vetoes.length ? (
        <ul className="space-y-0.5 text-[11px] text-amber-200/80">
          {play.vetoes.map((v) => (
            <li key={v}>· {v}</li>
          ))}
        </ul>
      ) : null}

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
    const s = portfolio?.summary;
    const onScreen = s
      ? bookVetoes({
          equity: s.totalEquity,
          cashPct: s.totalEquity > 0 ? (s.cashUsd / s.totalEquity) * 100 : 0,
          drawdownPct: s.currentDrawdownPct,
        })
      : [];
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
        (body?.plays ?? []).filter((p) => p.account.toLowerCase() === key),
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
          <ul className="mt-2 space-y-0.5 border-t border-white/10 pt-2">
            {vetoes.map((v) => (
              <li key={v} className="flex items-center gap-1.5 text-xs text-rose-200/90">
                <ShieldAlert size={12} className="shrink-0 text-rose-300" />
                {v}
              </li>
            ))}
          </ul>
        ) : body ? (
          <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/40">No book veto.</p>
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
          Nothing on the tape overlaps a launchpad or theme this book has traded, above the liquidity floor.
        </p>
      ) : (
        <section className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plays.slice(0, MAX_CARDS).map((p) => (
            <PlayCard key={`${p.chain}:${p.mint}`} play={p} bookVetoed={vetoes.length > 0} />
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
