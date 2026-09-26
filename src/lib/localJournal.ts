import type { ClosedTrade, EquityPoint } from '../types/portfolio.ts';

const CONFIG_KEY = 'fomo-dashboard-config';
const LEGACY_PEAK_KEY = 'fomo-dashboard-peak-equity';
const LEGACY_CURVE_KEY = 'fomo-dashboard-equity-log';
const LEGACY_OWNER = 'busymeredog';
const WALLETS_KEY = 'fomo-dashboard-wallets';
const RECENT_KEY = 'fomo-dashboard-recent-handles';

export interface ClientConfig {
  handle: string;
  apiKey: string;
  solanaWallet: string;
  evmWallet: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
}

export const emptyConfig = (): ClientConfig => ({
  handle: '',
  apiKey: '',
  solanaWallet: '',
  evmWallet: '',
  llmApiKey: '',
  llmModel: 'gpt-5.4',
  llmBaseUrl: '',
});

// Addresses the operator has replaced; drop them wherever an older build saved them.
const RETIRED_WALLETS = new Set(['7G4MHQzKBdiMuwW1E2cCpEti8wQDxd8gj8rjS3kyF67b']);

function live(addr?: string): string {
  return addr && !RETIRED_WALLETS.has(addr) ? addr : '';
}

export function normHandle(handle?: string): string {
  return (handle || '').replace(/^@/, '').trim().toLowerCase();
}

export function loadClientConfig(): ClientConfig {
  const base: ClientConfig = {
    handle: import.meta.env.VITE_FOMO_HANDLE || '',
    apiKey: '',
    solanaWallet: import.meta.env.VITE_SOLANA_WALLET || '',
    evmWallet: import.meta.env.VITE_EVM_WALLET || '',
    llmApiKey: '',
    llmModel: 'gpt-5.4',
    llmBaseUrl: '',
  };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<ClientConfig>;
    return {
      handle: parsed.handle || base.handle,
      apiKey: parsed.apiKey || '',
      solanaWallet: live(parsed.solanaWallet) || base.solanaWallet,
      evmWallet: parsed.evmWallet || base.evmWallet,
      llmApiKey: parsed.llmApiKey || '',
      llmModel: parsed.llmModel || base.llmModel,
      llmBaseUrl: parsed.llmBaseUrl || '',
    };
  } catch {
    return base;
  }
}

export function saveClientConfig(cfg: ClientConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

type WalletPair = { solana?: string; evm?: string };

function readWalletBook(): Record<string, WalletPair> {
  try {
    return JSON.parse(localStorage.getItem(WALLETS_KEY) || '{}') as Record<string, WalletPair>;
  } catch {
    return {};
  }
}

/** Wallets the server resolved for this handle on a previous load. */
export function walletsFor(handle: string): WalletPair {
  const row = readWalletBook()[normHandle(handle)] ?? {};
  return { solana: live(row.solana) || undefined, evm: row.evm };
}

export function rememberWallets(handle: string, wallets: WalletPair) {
  const key = normHandle(handle);
  if (!key || (!wallets.solana && !wallets.evm)) return;
  const book = readWalletBook();
  const prev = book[key] ?? {};
  // The server's answer is authoritative, so a changed default replaces the old hint.
  book[key] = { solana: live(wallets.solana) || live(prev.solana), evm: wallets.evm || prev.evm };
  localStorage.setItem(WALLETS_KEY, JSON.stringify(book));
}

export function recentHandles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[];
  } catch {
    return [];
  }
}

export function rememberHandle(handle: string): string[] {
  const clean = handle.replace(/^@/, '').trim();
  if (!clean) return recentHandles();
  const next = [clean, ...recentHandles().filter((h) => normHandle(h) !== normHandle(clean))].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

function scopedKey(base: string, handle: string) {
  return `${base}:${normHandle(handle) || 'wallet'}`;
}

function readScoped(base: string, legacy: string, handle: string): string | null {
  const own = localStorage.getItem(scopedKey(base, handle));
  if (own != null) return own;
  return normHandle(handle) === LEGACY_OWNER ? localStorage.getItem(legacy) : null;
}

export function rememberPeak(handle: string, equity: number): number {
  const prev = Number(readScoped(LEGACY_PEAK_KEY, LEGACY_PEAK_KEY, handle) || 0);
  const peak = Math.max(prev, equity, 0);
  localStorage.setItem(scopedKey(LEGACY_PEAK_KEY, handle), String(peak));
  return peak;
}

export function readEquityLog(handle: string): EquityPoint[] {
  try {
    const raw = readScoped(LEGACY_CURVE_KEY, LEGACY_CURVE_KEY, handle) || '[]';
    return (JSON.parse(raw) as EquityPoint[]).filter((p) => p.equity > 0);
  } catch {
    return [];
  }
}

export function appendEquityLog(handle: string, point: EquityPoint): EquityPoint[] {
  const log = readEquityLog(handle);
  const filtered = log.filter((p) => p.date !== point.date);
  filtered.push(point);
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = filtered.slice(-180);
  localStorage.setItem(scopedKey(LEGACY_CURVE_KEY, handle), JSON.stringify(trimmed));
  return trimmed;
}

export function mergeEquityLogs(live: EquityPoint[], stored: EquityPoint[]): EquityPoint[] {
  const byDay = new Map<string, EquityPoint>();
  for (const p of stored) byDay.set(p.date, p);
  for (const p of live) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function noteKey(trade: ClosedTrade): string {
  return `fomo-note-${trade.id}`;
}
