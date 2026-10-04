import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { ChatSnapshot, ChatTurn } from '../lib/ai/bookContext';
import { cn } from '../lib/format';

const PROMPTS = [
  "What's overweight vs the 15% cap?",
  'Which launchpad / narrative is rotating in?',
  'Walk the 24h tape.',
  'Cash vs open risk — what should I do?',
];

interface Props {
  snapshot: ChatSnapshot | null;
  prompts?: string[];
  thread?: ChatTurn[];
  onThread?: (turns: ChatTurn[]) => void;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  hasServerKey: boolean;
  onAttach: () => void;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: (T & { message?: string }) | null = null;
  try {
    body = text ? (JSON.parse(text) as T & { message?: string }) : null;
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').slice(0, 180) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  if (!body) throw new Error('Empty chat response');
  return body;
}

export function ChatPanel({
  snapshot,
  prompts = PROMPTS,
  thread,
  onThread,
  llmApiKey,
  llmModel,
  llmBaseUrl,
  hasServerKey,
  onAttach,
}: Props) {
  const [localMessages, setLocalMessages] = useState<ChatTurn[]>([]);
  const messages = thread ?? localMessages;
  const setMessages = onThread ?? setLocalMessages;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(llmApiKey || hasServerKey);
  const modelLabel = llmModel || 'gpt-5.4';

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    if (!ready) {
      onAttach();
      setError('Attach an LLM key in Sources (OpenAI-compatible).');
      return;
    }
    if (!snapshot) {
      setError('Load a book first so the desk can see the tape.');
      return;
    }
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(llmApiKey ? { 'x-llm-api-key': llmApiKey } : {}),
        },
        body: JSON.stringify({
          messages: next,
          snapshot,
          model: modelLabel,
          ...(llmBaseUrl ? { baseUrl: llmBaseUrl } : {}),
        }),
      });
      const body = await readJson<{ text: string; model?: string }>(res);
      setMessages([...next, { role: 'assistant', content: body.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  return (
    <section className="flex min-h-[320px] flex-col rounded-2xl border border-white/10 bg-[#0d0f18]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-fuchsia-300" />
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Desk chat
          </h3>
        </div>
        <span className="font-mono text-[10px] text-white/35">
          {ready ? modelLabel : 'no LLM key'}
        </span>
      </div>

      <div className="min-h-[160px] flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-white/45">
              Talk to the live book. The model only sees this snapshot — it will not invent fills FOMO
              did not capture.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void send(p)}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/5"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn(
                'rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                m.role === 'user'
                  ? 'ml-8 bg-fuchsia-500/15 text-fuchsia-50'
                  : 'mr-4 bg-white/5 text-white/85',
              )}
            >
              {m.content}
            </div>
          ))
        )}
        {busy ? <p className="text-[11px] text-white/40">Desk is reading the book…</p> : null}
      </div>

      {error ? (
        <p className="px-3 pb-1 text-[11px] text-rose-300">
          {error}{' '}
          {!ready ? (
            <button type="button" className="underline" onClick={onAttach}>
              Attach key
            </button>
          ) : null}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-white/10 p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          placeholder={ready ? 'Ask the desk about this book…' : 'Attach an LLM key in Sources'}
          className="max-h-28 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm outline-none focus:border-fuchsia-400/60"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500 text-black hover:bg-fuchsia-400 disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </form>
    </section>
  );
}
