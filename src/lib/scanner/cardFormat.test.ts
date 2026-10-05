import { describe, expect, it } from 'vitest';
import { ageLabel, capBand, categoryOf, matchesFilters } from './cardFormat.ts';

describe('card chips', () => {
  it('maps themes to the category chip', () => {
    expect(categoryOf({ themes: ['Animals'], bookEdge: 'Fits animals' })).toBe('Animals');
    expect(categoryOf({ themes: ['AI / agents'], bookEdge: 'New to this book' })).toBe('AI');
    expect(categoryOf({ themes: ['CT figures'], bookEdge: '' })).toBe('CT');
    expect(categoryOf({ themes: ['AI / agents', 'Animals'], bookEdge: 'Fits AI / agents' })).toBe('AI');
    expect(categoryOf({ themes: [], bookEdge: 'New to this book' })).toBe('Other');
    expect(categoryOf({ themes: ['NEAR'], bookEdge: '' })).toBe('Other');
    expect(categoryOf({ themes: [], bookEdge: 'Fits animals' })).toBe('Animals');
  });

  it('bands market cap and never guesses a missing one', () => {
    expect(capBand(48_600)).toEqual({ band: 'Micro', label: 'Micro $49k' });
    expect(capBand(106_000).label).toBe('Small $106k');
    expect(capBand(1_200_000).label).toBe('Mid $1.2M');
    expect(capBand(18_000_000).label).toBe('Large $18.0M');
    expect(capBand(null)).toEqual({ band: 'All caps', label: 'mcap ?' });
    expect(ageLabel(1.2)).toBe('1h');
    expect(ageLabel(0.4)).toBe('24m');
  });

  it('shows a card only when both filters match', () => {
    const kermit = { themes: ['Animals'], bookEdge: 'Fits animals', marketCapUsd: 60_000 };
    expect(matchesFilters(kermit, 'All', 'All caps')).toBe(true);
    expect(matchesFilters(kermit, 'Animals', 'Micro')).toBe(true);
    expect(matchesFilters(kermit, 'Animals', 'Small')).toBe(false);
    expect(matchesFilters(kermit, 'AI', 'Micro')).toBe(false);
    expect(matchesFilters({ ...kermit, marketCapUsd: null }, 'All', 'Micro')).toBe(false);
  });
});
