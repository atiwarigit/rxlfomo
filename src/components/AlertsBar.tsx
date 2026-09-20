import type { PortfolioAlert } from '../types/portfolio';
import { cn } from '../lib/format';

export function AlertsBar({ alerts }: { alerts: PortfolioAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            a.level === 'crit' && 'border-rose-500/40 bg-rose-500/10 text-rose-200',
            a.level === 'warn' && 'border-amber-500/40 bg-amber-500/10 text-amber-100',
            a.level === 'info' && 'border-sky-500/40 bg-sky-500/10 text-sky-100',
          )}
        >
          {a.message}
        </div>
      ))}
    </div>
  );
}
