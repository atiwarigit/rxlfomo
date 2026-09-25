import { describe, expect, it } from 'vitest';
import { sparklineFromMove } from './spark.ts';

describe('sparklineFromMove', () => {
  it('builds a rising path from a 24h percent', () => {
    const pts = sparklineFromMove(110, 10, 3);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toBeCloseTo(100);
    expect(pts[1]).toBeCloseTo(105);
    expect(pts[2]).toBeCloseTo(110);
  });

  it('stays flat when the move is missing', () => {
    const pts = sparklineFromMove(50, null, 4);
    expect(pts.every((v) => v === 50)).toBe(true);
  });

  it('returns zeros for a dead mark', () => {
    expect(sparklineFromMove(0, 12, 3)).toEqual([0, 0, 0]);
  });
});
