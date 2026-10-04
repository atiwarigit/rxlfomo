import type { PortfolioSnapshot } from '../../types/portfolio.ts';
import type { Play, PlayBook } from '../../types/plays.ts';
import { launchpadRotation, narrativeRotation } from '../ops/rotation.ts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function compactBook(snap: PortfolioSnapshot): string {
  const s = snap.summary;
  const lines: string[] = [
    `Handle: @${snap.handle || 'unknown'} (${snap.displayName || 'n/a'})`,
    `Equity: ${n(s.totalEquity)} | Cash: ${n(s.cashUsd)} (${pct(s.cashUsd, s.totalEquity)}) | Open: ${n(s.openPositionsValue)}`,
    `Unrealized: ${n(s.unrealizedPnl)} | Realized: ${s.realizedPnlAllTime == null ? 'n/a' : n(s.realizedPnlAllTime)} | 24h: ${snap.pnlWindows.h24 == null ? 'n/a' : n(snap.pnlWindows.h24)}`,
    `Volume: ${s.volumeUsd == null ? 'n/a' : n(s.volumeUsd)} | FOMO trades: ${s.totalTrades} captured closes: ${s.closedTradesCaptured}`,
    `Drawdown: ${s.currentDrawdownPct.toFixed(1)}% from peak ${n(s.peakEquity)} | Rank: ${s.leaderboardRank ?? 'n/a'} | Followers: ${s.followers}`,
    `Wallets: SOL ${snap.wallets.solana || '—'} | EVM ${snap.wallets.evm || '—'}`,
    `Sources: fomo=${snap.source.fomo} onchain=${snap.source.onchain} at ${snap.source.fetchedAt}`,
  ];
  if (snap.source.warnings.length) lines.push(`Warnings: ${snap.source.warnings.join(' | ')}`);
  lines.push('Open names (size, 24h, unrealized, basis, chain, launchpad, narratives, paired vs):');
  for (const p of snap.openPositions.slice(0, 16)) {
    lines.push(
      `- ${p.symbol} ${n(p.sizeUsd)} 24h=${p.change24hPct == null ? 'n/a' : p.change24hPct.toFixed(1) + '%'} u=${n(p.unrealizedPnl)} basis=${p.hasCostBasis ? 'yes' : 'no'} ${p.chain} pad=${p.launchpad || '?'} story=${(p.narratives || []).join('/') || '?'}${p.quoteSymbol ? ` vs=${p.quoteSymbol}` : ''}${p.strategy && p.strategy !== 'trade' ? ` strategy=${p.strategy}${p.dripPays ? ` pays=${p.dripPays}` : ''}${p.dripFrom?.length ? ` from=${p.dripFrom.join('/')}` : ''}${p.dripPerDayUsd ? ` drip/day~${n(p.dripPerDayUsd)}` : ''}` : ''}${p.thesis ? ` thesis="${p.thesis.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}`,
    );
  }
  const pads = launchpadRotation(snap);
  if (pads.length) {
    lines.push('By launchpad (open size, size-weighted 24h, unrealized, realized, wins/closes):');
    for (const r of pads.slice(0, 8)) {
      lines.push(
        `- ${r.label}: ${n(r.sizeUsd)} 24h=${r.move24hPct == null ? 'n/a' : r.move24hPct.toFixed(1) + '%'} u=${n(r.unrealizedUsd)} r=${n(r.realizedUsd)} ${r.wins}/${r.closes}`,
      );
    }
  }
  const stories = narrativeRotation(snap);
  if (stories.length) {
    lines.push(
      `By narrative: ${stories
        .slice(0, 8)
        .map((r) => `${r.label} ${n(r.sizeUsd)} net=${n(r.totalPnlUsd)}`)
        .join(' | ')}`,
    );
  }
  if (snap.closedTrades.length) {
    lines.push('Recent closes:');
    for (const t of snap.closedTrades.slice(0, 6)) {
      lines.push(`- ${t.symbol} ${n(t.realizedPnl)} ${t.exitDate.slice(0, 10)}`);
    }
  }
  if (snap.alerts.length) {
    lines.push(`Alerts: ${snap.alerts.map((a) => a.message).join(' | ')}`);
  }
  lines.push(
    'Desk rules: cash floor 20%, single-name cap ~15% once book is large, size down after 8% drawdown, do not invent fills FOMO did not capture.',
  );
  return lines.join('\n');
}

export interface ScannerChatSnapshot {
  book: PortfolioSnapshot | null;
  plays: Play[];
  books?: PlayBook[];
  tapeCount?: number;
}

export type ChatSnapshot = PortfolioSnapshot | ScannerChatSnapshot;

export function isScannerSnapshot(snap: unknown): snap is ScannerChatSnapshot {
  return Boolean(snap && typeof snap === 'object' && 'plays' in snap && Array.isArray((snap as ScannerChatSnapshot).plays));
}

export function compactPlays(snap: ScannerChatSnapshot): string {
  const lines: string[] = [];
  for (const b of snap.books || []) {
    lines.push(
      `Book @${b.handle}: equity ${n(b.equity)} cash ${b.cashPct.toFixed(0)}% drawdown ${b.drawdownPct.toFixed(1)}% size-floor liquidity ${n(b.sizeFloorLiq)}`,
    );
    lines.push(`Book vetoes: ${b.vetoes.length ? b.vetoes.join(' | ') : 'none'}`);
  }
  if (snap.tapeCount != null) lines.push(`Tape rows scanned: ${snap.tapeCount}`);
  const sized = snap.plays.filter((p) => p.decision === 'size').length;
  lines.push(`Cards: ${snap.plays.length} (${sized} size, ${snap.plays.length - sized} watch), ranked by score:`);
  snap.plays.forEach((p, i) => {
    lines.push(
      `${i + 1}. ${p.symbol} [${p.decision}] score=${p.score} ${p.chain} pad=${p.launchpad} themes=${p.themes.join('/') || '—'} trigger=${p.trigger} liq=${n(p.liquidityUsd)} vol1h=${n(p.volume1hUsd)} 1h=${p.change1hPct == null ? 'n/a' : p.change1hPct.toFixed(1) + '%'} age=${p.ageHours == null ? 'n/a' : p.ageHours.toFixed(1) + 'h'} cap=${n(p.sizeCapUsd)}`,
    );
    lines.push(`   edge: ${p.bookEdge || '—'}`);
    lines.push(`   vetoes: ${p.vetoes.length ? p.vetoes.join(' | ') : 'none'}`);
  });
  if (!snap.plays.length) lines.push('(no card overlaps this book right now)');
  lines.push('A size cap is a ceiling, not an order. Skips are not listed.');
  return lines.join('\n');
}

function n(v: number): string {
  return v.toFixed(2);
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(0)}%`;
}
