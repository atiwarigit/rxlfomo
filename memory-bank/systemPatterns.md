# System patterns

- `loadPortfolio()` is the single aggregator. UI never talks to fomoapi.io or RPC directly.
- `/api/portfolio` and `/api/chat` (Vite middleware in dev, bundled `api/*.js` on Vercel) keep FOMO and LLM keys off the bundle. Vercel Node cannot import `src/*.ts` from `/api`, so `npm run build:api` esbuilds `server/vercel-*.ts` into ESM files (npm packages stay external).
- Desk chat is JSON (not streaming). Compact snapshot text is the only book the model sees. Default model `gpt-5.4`.
- FOMO failures degrade to wallet-only instead of showing mock data.
- SOL + stables = cash; other tokens = open risk. DexScreener 24h change is the live mark when FOMO has no cost basis. Spotlight + Relay fills entry/unrealized. Don't treat missing basis as $0 PnL.
- Peak equity and daily curve points persist in localStorage so drawdown/equity history compounds.
- Agent execution lives only in server routes: the browser sees the agent's public address, intents and positions, never `AGENT_SIGNER` or `DATABASE_URL`. Every intent row (rejected too) keeps the tape row, page book numbers, sizing and quote in `play_snapshot`.
