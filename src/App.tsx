import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Settings2, TrendingUp, Users, Wallet } from 'lucide-react';
import { AlertsBar } from './components/AlertsBar';
import { ClosedTradesTable } from './components/ClosedTradesTable';
import { EquityChart } from './components/EquityChart';
import { PositionsTable } from './components/PositionsTable';
import { RiskPanel } from './components/RiskPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatCard } from './components/StatCard';
import {
  appendEquityLog,
  emptyConfig,
  loadClientConfig,
  mergeEquityLogs,
  rememberPeak,
  saveClientConfig,
  type ClientConfig,
} from './lib/localJournal';
import { compactAddress } from './lib/portfolio/helpers';
import { formatPct, formatUsd } from './lib/format';
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

  useEffect(() => {
    void (async () => {
      let cfg = loadClientConfig();
      try {
        const defaults = await readJson<{
          handle?: string;
          solanaWallet?: string;
          evmWallet?: string;
        }>(await fetch('/api/defaults'));
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
        realizedPnl: snap.summary.realizedPnlAllTime,
      });
      snap.equityCurve = mergeEquityLogs(snap.equityCurve, stored);
      setData(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }

  const summary = data?.summary;
  const needsSetup = !config.handle && !config.solanaWallet && !data;

  const sourceLabel = useMemo(() => {
    if (!data) return 'Not connected';
    const bits = [];
    if (data.source.fomo) bits.push('FOMO API');
    if (data.source.onchain) bits.push('on-chain');
    return bits.length ? bits.join(' + ') : 'partial';
  }, [data]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-white">
      <header className="border-b border-white/10 bg-black/40 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">FOMO Portfolio Dashboard</h1>
            <p className="text-sm text-white/50">
              {data?.handle ? `@${data.handle}` : 'Live risk · reward · influence'}
              {data?.displayName ? ` · ${data.displayName}` : ''}
              {' · '}
              {sourceLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
            {data?.wallets.solana && (
              <span className="font-mono text-xs" title={data.wallets.solana}>
                SOL {compactAddress(data.wallets.solana)}
              </span>
            )}
            {summary && (
              <span className="flex items-center gap-1.5">
                <Users size={16} /> {summary.followers.toLocaleString()} followers
              </span>
            )}
            {summary?.leaderboardRank && (
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-emerald-400">
                Rank #{summary.leaderboardRank} all-time
              </span>
            )}
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15"
            >
              <Settings2 size={14} />
              Sources
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {needsSetup && (
          <section className="rounded-xl border border-dashed border-white/20 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">Connect live data</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Mock numbers are gone. Open <strong>Sources</strong>, add your FOMO handle plus a free
              key from <a className="text-emerald-400 underline" href="https://fomoapi.io/dashboard" target="_blank" rel="noreferrer">fomoapi.io</a>,
              and/or paste the Solana address linked to the handle. The dashboard will keep a local
              equity log so the curve compounds across sessions.
            </p>
          </section>
        )}

        {data?.source.warnings.length ? (
          <div className="space-y-1">
            {data.source.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-200/80">
                {w}
              </p>
            ))}
          </div>
        ) : null}

        {data && summary && (
          <>
            <AlertsBar alerts={data.alerts} />

            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <StatCard
                label="Total Equity"
                value={formatUsd(summary.totalEquity, true)}
                sub="Cash + open positions"
                trend="neutral"
              />
              <StatCard
                label="Realized PnL"
                value={formatUsd(summary.realizedPnlAllTime, true)}
                sub={
                  summary.realizedPnl7d != null
                    ? `7d ${formatUsd(summary.realizedPnl7d, true)}`
                    : 'All-time closed'
                }
                trend={summary.realizedPnlAllTime >= 0 ? 'up' : 'down'}
              />
              <StatCard
                label="Unrealized"
                value={formatUsd(summary.unrealizedPnl, true)}
                sub={
                  summary.openPositionsValue
                    ? formatPct((summary.unrealizedPnl / summary.openPositionsValue) * 100)
                    : 'Open book'
                }
                trend={summary.unrealizedPnl >= 0 ? 'up' : 'down'}
              />
              <StatCard
                label="Cash"
                value={formatUsd(summary.cashUsd, true)}
                sub={`${summary.totalEquity ? ((summary.cashUsd / summary.totalEquity) * 100).toFixed(0) : 0}% of equity`}
                trend="neutral"
              />
              <StatCard
                label="Drawdown"
                value={formatPct(summary.currentDrawdownPct)}
                sub={`Peak ${formatUsd(summary.peakEquity, true)}`}
                trend={summary.currentDrawdownPct < -5 ? 'down' : 'neutral'}
              />
              <StatCard
                label="Win Rate"
                value={`${summary.winRate.toFixed(1)}%`}
                sub={`PF ${summary.profitFactor.toFixed(2)} · ${summary.closedTradesCaptured}/${summary.totalTrades} trades`}
                trend={summary.winRate >= 50 ? 'up' : 'neutral'}
              />
            </section>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="PnL 24h"
                value={data.pnlWindows.h24 == null ? '—' : formatUsd(data.pnlWindows.h24, true)}
                trend={
                  data.pnlWindows.h24 == null ? 'neutral' : data.pnlWindows.h24 >= 0 ? 'up' : 'down'
                }
              />
              <StatCard
                label="PnL 30d"
                value={data.pnlWindows.d30 == null ? '—' : formatUsd(data.pnlWindows.d30, true)}
                trend={
                  data.pnlWindows.d30 == null ? 'neutral' : data.pnlWindows.d30 >= 0 ? 'up' : 'down'
                }
              />
              <StatCard
                label="Avg hold"
                value={
                  data.influence.averageHoldTimeHours != null
                    ? `${(data.influence.averageHoldTimeHours / 24).toFixed(1)}d`
                    : '—'
                }
                sub="FOMO average"
              />
              <StatCard
                label="Account age"
                value={
                  data.influence.accountAgeDays != null
                    ? `${data.influence.accountAgeDays}d`
                    : '—'
                }
                sub={data.wallets.evm ? `EVM ${compactAddress(data.wallets.evm)}` : 'FOMO profile'}
              />
            </section>

            <section className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp size={18} className="text-emerald-400" />
                  <h2 className="font-semibold">Equity Curve</h2>
                  <span className="text-xs text-white/40">
                    Live pull + local daily snapshots
                  </span>
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
                  <h2 className="font-semibold">Open Positions</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
                    {data.openPositions.length}
                  </span>
                </div>
                <p className="text-sm text-white/50">
                  Total open: {formatUsd(summary.openPositionsValue)}
                </p>
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
              Last fetch {new Date(data.source.fetchedAt).toLocaleString()} · FOMO numbers are
              cross-checked against wallet mark-to-market when an address is available.
            </p>
          </>
        )}
      </main>

      <SettingsPanel
        key={`${config.handle}-${settingsOpen}`}
        config={config}
        open={settingsOpen}
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
