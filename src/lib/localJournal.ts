import type { ClosedTrade, EquityPoint } from '../types/portfolio.ts';

const CONFIG_KEY = 'fomo-dashboard-config';
const PEAK_KEY = 'fomo-dashboard-peak-equity';
const CURVE_KEY = 'fomo-dashboard-equity-log';

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
      solanaWallet: parsed.solanaWallet || base.solanaWallet,
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

export function rememberPeak(equity: number): number {
  const prev = Number(localStorage.getItem(PEAK_KEY) || 0);
  const peak = Math.max(prev, equity, 0);
  localStorage.setItem(PEAK_KEY, String(peak));
  return peak;
}

export function appendEquityLog(point: EquityPoint): EquityPoint[] {
  let log: EquityPoint[] = [];
  try {
    log = JSON.parse(localStorage.getItem(CURVE_KEY) || '[]') as EquityPoint[];
  } catch {
    log = [];
  }
  const filtered = log.filter((p) => p.date !== point.date);
  filtered.push(point);
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = filtered.slice(-180);
  localStorage.setItem(CURVE_KEY, JSON.stringify(trimmed));
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
