import { cn } from '../lib/format';

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export function StatCard({ label, value, sub, trend = 'neutral', className }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm',
        className
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-white/50">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight',
          trend === 'up' && 'text-emerald-400',
          trend === 'down' && 'text-rose-400',
          trend === 'neutral' && 'text-white'
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}
