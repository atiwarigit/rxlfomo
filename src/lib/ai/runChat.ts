import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  compactBook,
  compactPlays,
  isScannerSnapshot,
  type ChatSnapshot,
  type ChatTurn,
} from './bookContext.ts';

const SYSTEM = `You are the FOMO desk copilot on rxlfomo. You see a live portfolio snapshot (wallet + FOMO + Dex 24h + Relay).
Answer like a trading desk: short, specific, numbered when useful.
Never invent closed-trade PnL, entries, or fills that are not in the snapshot. If cost basis is missing, say the number is 24h mark-to-market, not all-time PnL.
Cash = SOL + stables. Flag names >15% of equity and cash <20%.
Each name carries its launchpad (Pons, Bankr, Pump.fun, Stonk.fun…) and narrative tags; "Stonks" means paired against a tokenized stock. For rotation questions, compare launchpads/narratives by size-weighted 24h move and realized vs unrealized, and say which bucket is heating up or bleeding.
If the operator asks what to do, give a risk action (trim / hold / wait for cash) rather than a new meme call unless they ask for one.
When a SCANNER block is present, it lists tape cards scored against this book: decision is watch or size, the size cap is a ceiling not an order, and vetoes say exactly what blocked size. Name cards by symbol and quote the blocking veto. Never give buy/sell/sign instructions or invent cards that are not listed.`;

export class ChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatConfigError';
  }
}

export function resolveLlmConfig(env: Record<string, string | undefined>, headerKey?: string) {
  const apiKey =
    headerKey ||
    env.LLM_API_KEY ||
    env.AI_GATEWAY_API_KEY ||
    env.OPENAI_API_KEY ||
    '';
  const baseUrl = env.LLM_BASE_URL || env.OPENAI_BASE_URL || env.AI_GATEWAY_BASE_URL || '';
  const model = env.LLM_MODEL || 'gpt-5.4';
  return { apiKey, baseUrl, model };
}

export async function runPortfolioChat(input: {
  messages: ChatTurn[];
  snapshot?: ChatSnapshot | null;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ text: string; model: string }> {
  if (!input.apiKey.trim()) {
    throw new ChatConfigError(
      'Attach an LLM key: set LLM_API_KEY (OpenAI-compatible) or AI_GATEWAY_API_KEY on the server, or paste it in Sources.',
    );
  }
  const modelId = (input.model || 'gpt-5.4').trim();
  const openai = createOpenAI({
    apiKey: input.apiKey.trim(),
    ...(input.baseUrl ? { baseURL: input.baseUrl.replace(/\/$/, '') } : {}),
  });
  const { text } = await generateText({
    model: openai(modelId.replace(/^openai\//, '')),
    system: SYSTEM,
    prompt: chatPrompt(input.messages, input.snapshot),
    abortSignal: AbortSignal.timeout(55_000),
  });
  return { text: text.trim(), model: modelId };
}

export function chatPrompt(messages: ChatTurn[], snap?: ChatSnapshot | null): string {
  const portfolio = isScannerSnapshot(snap) ? snap.book : snap;
  const book = portfolio ? compactBook(portfolio) : 'No live book is loaded.';
  const scanner = isScannerSnapshot(snap) ? `\n\nSCANNER\n${compactPlays(snap)}` : '';
  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'Operator' : 'Desk'}: ${m.content.trim()}`)
    .join('\n');
  return `LIVE BOOK\n${book}${scanner}\n\nTHREAD\n${history || '(none yet)'}\n\nReply as Desk.`;
}
