import type { Chain } from '../../types/portfolio.ts';

const STABLE_SYMBOLS = new Set([
  'USDC',
  'USDT',
  'USD1',
  'PYUSD',
  'USDS',
  'DAI',
  'FDUSD',
  'CASH',
  'USD',
  'USDC.E',
]);

const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
]);

const WSOL = 'So11111111111111111111111111111111111111112';

export function isCashAsset(symbol?: string, mint?: string): boolean {
  const sym = (symbol || '').toUpperCase();
  if (sym === 'SOL' || sym === 'WSOL') return true;
  if (STABLE_SYMBOLS.has(sym)) return true;
  if (mint && (mint === WSOL || STABLE_MINTS.has(mint))) return true;
  return false;
}

export function normalizeChain(raw?: string, networkId?: number): Chain {
  const s = (raw || '').toLowerCase();
  if (networkId === 1399811149 || s.includes('sol')) return 'solana';
  if (networkId === 8453 || s.includes('base')) return 'base';
  if (networkId === 56 || s.includes('bnb') || s.includes('bsc')) return 'bnb';
  if (networkId === 1 || s === 'eth' || s.includes('ethereum')) return 'ethereum';
  if (networkId === 4663 || s.includes('robin') || s.includes('hood')) return 'robinhood';
  if (networkId === 143 || s.includes('monad')) return 'monad';
  if (s.includes('hyper')) return 'hyperliquid';
  return 'other';
}

export function hoursBetween(from?: string | null, to?: string | null): number {
  if (!from) return 0;
  const a = Date.parse(from);
  const b = to ? Date.parse(to) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 3_600_000);
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function compactAddress(addr?: string, size = 4): string {
  if (!addr) return '—';
  if (addr.length <= size * 2 + 3) return addr;
  return `${addr.slice(0, size)}…${addr.slice(-size)}`;
}
