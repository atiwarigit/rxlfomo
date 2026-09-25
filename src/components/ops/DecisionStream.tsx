import type { DecisionEvent } from '../../lib/ops/stream';
import { cn } from '../../lib/format';

const TONE: Record<DecisionEvent['tone'], string> = {
  long: 'bg-fuchsia-500/20 text-fuchsia-200',
  thesis: 'bg-violet-500/20 text-violet-200',
  alert: 'bg-amber-500/20 text-amber-200',
  close: 'bg-sky-500/20 text-sky-200',
  mark: 'bg-emerald-500/20 text-emerald-200',
};

export function DecisionStream({ events }: { events: DecisionEvent[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-[#0d0f18]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Decision stream
        </h3>
        <span className="font-mono text-[10px] text-white/35">{events.length} live</span>
      </div>
      <div className="min-h-[220px] flex-1 space-y-1 overflow-y-auto p-2">
        {events.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-white/35">No tape yet. Load a book.</p>
        ) : (
          events.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  TONE[e.tone],
                )}
              >
                {e.actor.slice(0, 8)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium">{e.action}</p>
                <p className="truncate text-[10px] text-white/40">{e.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
