import type { Play } from '../../types/plays.ts';

export const CATEGORIES = ['All', 'Animals', 'AI', 'Stonks', 'CT', 'Other'] as const;
export const CAPS = ['All caps', 'Micro', 'Small', 'Mid', 'Large'] as const;

export type Category = (typeof CATEGORIES)[number];
export type CapFilter = (typeof CAPS)[number];

const THEME_TO_CATEGORY: Record<string, Category> = {
  animals: 'Animals',
  'ai / agents': 'AI',
  ai: 'AI',
  stonks: 'Stonks',
  'ct figures': 'CT',
  ct: 'CT',
};

export function money(usd: number) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`;
  return `$${Math.round(usd)}`;
}

export function capBand(usd?: number | null): { band: CapFilter; label: string } {
  if (usd == null) return { band: 'All caps', label: 'mcap ?' };
  if (usd < 100_000) return { band: 'Micro', label: `Micro ${money(usd)}` };
  if (usd < 1_000_000) return { band: 'Small', label: `Small ${money(usd)}` };
  if (usd < 10_000_000) return { band: 'Mid', label: `Mid ${money(usd)}` };
  return { band: 'Large', label: `Large ${money(usd)}` };
}

export function ageLabel(hours?: number | null) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** From the theme field; a "Fits <theme>" book word still yields its chip when themes are empty. */
export function categoryOf(play: Pick<Play, 'themes' | 'bookEdge'>): Exclude<Category, 'All'> {
  const fromTheme = play.themes.map((t) => THEME_TO_CATEGORY[t.toLowerCase()]).find(Boolean);
  if (fromTheme && fromTheme !== 'All') return fromTheme;
  const fit = /^Fits (.+)$/i.exec(play.bookEdge || '')?.[1]?.toLowerCase();
  const fromFit = fit ? THEME_TO_CATEGORY[fit] : undefined;
  return fromFit && fromFit !== 'All' ? fromFit : 'Other';
}

export function matchesFilters(
  play: Pick<Play, 'themes' | 'bookEdge' | 'marketCapUsd'>,
  category: Category,
  cap: CapFilter,
): boolean {
  if (category !== 'All' && categoryOf(play) !== category) return false;
  if (cap !== 'All caps' && capBand(play.marketCapUsd).band !== cap) return false;
  return true;
}
