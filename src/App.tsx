import { useEffect, useMemo, useState } from 'react';
import { Activity, TrendingUp, Wallet } from 'lucide-react';
import { AlertsBar } from './components/AlertsBar';
import { ChatPanel } from './components/ChatPanel';
import { ClosedTradesTable } from './components/ClosedTradesTable';
import { EquityChart } from './components/EquityChart';
import { PositionsTable } from './components/PositionsTable';
import { RiskPanel } from './components/RiskPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DecisionStream } from './components/ops/DecisionStream';
import { HeaderStrip } from './components/ops/HeaderStrip';
import { HeroPositionCard } from './components/ops/HeroPositionCard';
import { SizeBoard } from './components/ops/SizeBoard';
import { TapeBar } from './components/ops/TapeBar';
import {
  appendEquityLog,
  emptyConfig,
  loadClientConfig,
  mergeEquityLogs,
  readEquityLog,
  rememberPeak,
  rememberWallets,
  saveClientConfig,
  type ClientConfig,
} from './lib/localJournal';
import { heroSlots } from './lib/ops/heroes';
import { buildDecisionStream } from './lib/ops/stream';
import type { PortfolioSnapshot } from './types/portfolio';

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: (T & { message?: string; error?: string }) | null = null;
  try {
    body = text ? (JSON.parse(text) as T & { message?: string; error?: string }) : null;
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').slice(0, 180) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Portfolio API returned an empty response');
  }
  return body;
}

async function fetchPortfolio(cfg: ClientConfig): Promise<PortfolioSnapshot> {
  const params = new URLSearchParams();
  if (cfg.handle) params.set('handle', cfg.handle);
  if (cfg.solanaWallet) params.set('solana', cfg.solanaWallet);
  if (cfg.evmWallet) params.set('evm', cfg.evmWallet);
  const res = await fetch(`/api/portfolio?${params.toString()}`, {
    headers: cfg.apiKey ? { 'x-fomo-api-key': cfg.apiKey } : undefined,
  });
  return readJson<PortfolioSnapshot>(res);
}

function App() {
  const [config, setConfig] = useState<ClientConfig>(emptyConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [data, setData] = useState<PortfolioSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasServerLlmKey, setHasServerLlmKey] = useState(false);

  useEffect(() => {
    void (async () => {
      let cfg = loadClientConfig();
      try {
        const defaults = await readJson<{
          handle?: string;
          solanaWallet?: string;
          evmWallet?: string;
          hasLlmKey?: boolean;
        }>(await fetch('/api/defaults'));
        setHasServerLlmKey(Boolean(defaults.hasLlmKey));
        if (defaults.handle) {
          const leftoverWallet = !cfg.handle;
          cfg = {
            ...cfg,
            handle: defaults.handle,
            solanaWallet: leftoverWallet ? defaults.solanaWallet || '' : cfg.solanaWallet,
            evmWallet: leftoverWallet ? defaults.evmWallet || '' : cfg.evmWallet,
          };
        }
      } catch {
        // keep local config
      }
      setConfig(cfg);
      if (cfg.handle || cfg.solanaWallet) {
        void refresh(cfg);
      } else {
        setSettingsOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(cfg = config) {
    if (!cfg.handle && !cfg.solanaWallet) {
      setSettingsOpen(true);
      setError('Add a FOMO handle and API key, or a Solana wallet, to load live data.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchPortfolio(cfg);
      const remembered = rememberWallets(cfg, snap.wallets);
      if (remembered !== cfg) setConfig(remembered);
      const live = snap.source.fomo || snap.source.onchain;
      if (live) {
        const peak = rememberPeak(snap.summary.totalEquity);
        snap.summary.peakEquity = Math.max(peak, snap.summary.peakEquity);
        snap.summary.currentDrawdownPct =
          snap.summary.peakEquity > 0
            ? ((snap.summary.totalEquity - snap.summary.peakEquity) / snap.summary.peakEquity) * 100
            : 0;
        const today = new Date().toISOString().slice(0, 10);
        const stored = appendEquityLog({
          date: today,
          equity: snap.summary.totalEquity,
          realizedPnl: snap.summary.realizedPnlAllTime ?? 0,
        });
        snap.equityCurve = mergeEquityLogs(snap.equityCurve, stored);
      } else {
        snap.equityCurve = mergeEquityLogs([], readEquityLog());
        setError(
          'No live source answered (see warnings). Paste your Solana address in Sources to load the book from chain while FOMO is down. The curve below is your last good history, not a $0 print.',
        );
      }
      setData(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }

  const summary = data?.summary;
  const needsSetup = !config.handle && !config.solanaWallet && !data;
  const stream = useMemo(() => (data ? buildDecisionStream(data) : []), [data]);
  const heroes = useMemo(() => (data ? heroSlots(data) : []), [data]);

  const sourceLabel = useMemo(() => {
    if (!data) return 'Not connected';
    const bits = [];
    if (data.source.fomo) bits.push('FOMO API');
    if (data.source.onchain) bits.push('on-chain');
    return bits.length ? bits.join(' + ') : 'partial';
  }, [data]);

  return (
    <div className="min-h-screen bg-[#07080e] text-white">
      <HeaderStrip
        data={data}
        decisions={stream.length}
        sourceLabel={sourceLabel}
        loading={loading}
        onRefresh={() => void refresh()}
        onSources={() => setSettingsOpen(true)}
      />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {needsSetup && (
          <section className="rounded-xl border border-dashed border-white/20 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">Connect live data</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Open <strong>Sources</strong>, add your FOMO handle plus a free key from{' '}
              <a
                className="text-emerald-400 underline"
                href="https://fomoapi.io/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                fomoapi.io
              </a>
              , and/or paste the Solana address. Attach an OpenAI-compatible LLM key in the same panel
              so the desk chat can read this book.
            </p>
          </section>
        )}

        {data?.source.warnings.length ? (
          <div className="space-y-1">
            {[...new Set(data.source.warnings)].map((w) => (
              <p key={w} className="text-xs text-amber-200/80">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        {data && summary && (
          <>
            <AlertsBar alerts={data.alerts} />

            <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-3 md:grid-cols-3">
                {heroes.map((slot) => (
                  <HeroPositionCard key={`${slot.kind}-${slot.label}-${slot.rank}`} slot={slot} />
                ))}
              </div>
              <div className="flex min-h-0 flex-col gap-3">
                <SizeBoard data={data} />
                <DecisionStream events={stream} />
                <ChatPanel
                  snapshot={data}
                  llmApiKey={config.llmApiKey}
                  llmModel={config.llmModel}
                  llmBaseUrl={config.llmBaseUrl}
                  hasServerKey={hasServerLlmKey}
                  onAttach={() => setSettingsOpen(true)}
                />
              </div>
            </section>

            <TapeBar data={data} />

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-[#0d0f18] p-4 lg:col-span-2">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp size={18} className="text-emerald-400" />
                  <h2 className="font-semibold">Equity curve</h2>
                  <span className="text-xs text-white/40">Live 24h mark + local daily snapshots</span>
                </div>
                {data.equityCurve.length > 1 ? (
                  <EquityChart data={data.equityCurve} />
                ) : (
                  <p className="py-16 text-center text-sm text-white/40">
                    Curve builds as closed trades and daily snapshots land.
                  </p>
                )}
              </div>
              <RiskPanel summary={summary} positions={data.openPositions} />
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={18} className="text-sky-400" />
                  <h2 className="font-semibold">Open positions</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                    {data.openPositions.length}
                  </span>
                </div>
              </div>
              <PositionsTable positions={data.openPositions} totalEquity={summary.totalEquity} />
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <Activity size={18} className="text-violet-400" />
                <h2 className="font-semibold">Closed trades</h2>
              </div>
              <ClosedTradesTable
                trades={data.closedTrades}
                captured={summary.closedTradesCaptured}
                totalOnFomo={summary.totalTrades}
              />
            </section>

            <p className="text-center text-xs text-white/30">
              Last fetch {new Date(data.source.fetchedAt).toLocaleString()} · 24h sparks are linear Dex
              moves, not tick charts. Chat sees this snapshot only.
            </p>
          </>
        )}
      </main>

      <SettingsPanel
        key={`${config.handle}-${settingsOpen}`}
        config={config}
        open={settingsOpen}
        hasServerLlmKey={hasServerLlmKey}
        onClose={() => setSettingsOpen(false)}
        onSave={(cfg) => {
          saveClientConfig(cfg);
          setConfig(cfg);
          setSettingsOpen(false);
          void refresh(cfg);
        }}
      />
    </div>
  );
}

export default App;
