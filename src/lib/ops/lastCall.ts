import type { Position } from '../../types/portfolio.ts';

export interface CallBar {
  label: string;
  pct: number;
}

export interface LastCall {
  action: string;
  bars: CallBar[];
}

export function lastCallForPosition(p: Position): LastCall {
  const chg = p.change24hPct ?? 0;
  const mag = Math.min(92, Math.round(Math.abs(chg) * 3.2 + (p.hasCostBasis ? 28 : 18)));
  const primary =
    Math.abs(chg) < 3 ? 'HOLD' : chg >= 0 ? 'RIDE' : `FADE_LONG_${p.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'BAG'}`;
  const secondary = p.thesis ? 'THESIS' : p.hasCostBasis ? 'MARK_BASIS' : 'MARK_24H';
  const rest = Math.max(8, 100 - mag);
  const thirdShare = Math.round(rest * 0.35);
  return {
    action: primary,
    bars: [
      { label: primary, pct: mag },
      { label: secondary, pct: rest - thirdShare },
      { label: p.chain.toUpperCase(), pct: thirdShare },
    ],
  };
}

export function lastCallForCash(cashPct: number): LastCall {
  const tight = cashPct < 20;
  const action = tight ? 'WAIT_CASH' : 'FLAT';
  return {
    action,
    bars: [
      { label: action, pct: tight ? 72 : 54 },
      { label: 'DEPLOY', pct: tight ? 18 : 34 },
      { label: 'HOLD_USD', pct: 12 },
    ],
  };
}
