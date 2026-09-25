export function sparklineFromMove(now: number, changePct?: number | null, points = 28): number[] {
  const n = Math.max(2, points);
  if (!Number.isFinite(now) || now <= 0) return Array.from({ length: n }, () => 0);
  const start =
    changePct != null && Number.isFinite(changePct) && changePct > -99.9
      ? now / (1 + changePct / 100)
      : now;
  return Array.from({ length: n }, (_, i) => start + ((now - start) * i) / (n - 1));
}
