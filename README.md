# FOMO Portfolio Dashboard

Live risk/reward dashboard for [fomo.family](https://fomo.family) trading. It replaces mock PnL with a real data layer:

1. **FOMO API** ([fomoapi.io](https://fomoapi.io/docs)) — handle → Solana/EVM wallets, PnL windows, open/closed positions, balances, followers, leaderboard rank
2. **Your wallet** — Solana RPC (public node or Helius) + DexScreener/GeckoTerminal mark-to-market, so illiquid paper gains get a second look

A local equity log in the browser compounds daily snapshots so the curve keeps building after each refresh.

The UI is an ops floor: header P&L / volume / cash / open risk / decisions, three hero bags with 24h sparks and last-call bars, a size leaderboard, a decision stream, and a desk chat that can read the live book through an attached LLM.

## Quick start

```bash
cp .env.example .env
# set FOMO_HANDLE and FOMO_API_KEY (free key: https://fomoapi.io/dashboard)
# and/or SOLANA_WALLET if you already know the address

npm install
npm run dev
```

Open http://localhost:5173 — or use **Sources** in the UI to paste handle, API key, wallets, and an OpenAI-compatible LLM key (stored in this browser only).

```bash
npm test
npm run build
```

## What the live layer does

Each refresh hits `/api/portfolio`, which:

- Resolves `@handle` via `GET /v2/users/{handle}` (wallets, followers, 24h/7d/30d/all PnL)
- Pulls `GET /v2/users/{handle}/positions?deep=1` and `/balances`
- Looks up all-time leaderboard rank
- Reads the Solana wallet (`getBalance` + token accounts, or Helius DAS if `HELIUS_API_KEY` is set)
- Prices mints on DexScreener; SOL on GeckoTerminal
- Treats SOL + stables as dry powder; everything else as open risk
- Computes win rate, profit factor, drawdown vs peak, concentration, and liquidity warnings

FOMO does not expose a complete trade history. Closed-trade stats use the captured page; `closedTotalOnFomo` is shown so you can see the gap. Peak equity is remembered locally so drawdown survives sparse history.

## Env

| Variable | Where | Purpose |
| --- | --- | --- |
| `FOMO_API_KEY` | server | Bearer token for fomoapi.io |
| `FOMO_HANDLE` | server | Default trader handle |
| `SOLANA_WALLET` / `EVM_WALLET` | server | Manual overrides |
| `SOLANA_RPC_URL` | server | Defaults to publicnode |
| `HELIUS_API_KEY` | server | Better Solana asset list + prices |
| `VITE_FOMO_HANDLE` | client | Optional default handle (not the API key) |
| `LLM_API_KEY` / `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` | server | Desk chat (OpenAI-compatible) |
| `LLM_MODEL` | server | Defaults to `gpt-5.4` |
| `LLM_BASE_URL` | server | Optional OpenAI-compatible host (AI Gateway, OpenRouter) |

Do not put `FOMO_API_KEY` or LLM keys in a `VITE_` variable if you deploy the frontend publicly. The Sources panel sends the FOMO key as `x-fomo-api-key` and the LLM key as `x-llm-api-key` so they are not baked into the JS bundle.

## Deploy on Vercel

1. Import [atiwarigit/rxlfomo](https://github.com/atiwarigit/rxlfomo) in Vercel (or merge this branch to `main` if the project is already linked).
2. Framework preset: Vite. Output directory: `dist`.
3. Add environment variables for **Production** and **Preview**:

| Name | Value |
| --- | --- |
| `FOMO_HANDLE` | `BusyMereDog` |
| `FOMO_API_KEY` | your fomoapi.io key (Project → Settings → Environment Variables) |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` |

Never commit the API key. After the first deploy, `/api/defaults` should report `hasApiKey: true` and the dashboard will auto-load `@BusyMereDog`.

`/api/portfolio` and `/api/chat` are bundled (`npm run build:api`) so Vercel Node does not import `src/*.ts` at runtime. That script also runs as part of `npm run build`. Chat uses `ai` + `@ai-sdk/openai` (`generateText`, JSON, no streaming). Attach `LLM_API_KEY` (or paste it in Sources) before the desk will answer.

## Project structure

```
src/lib/fomo/          FOMO REST client
src/lib/wallet/        Solana RPC + DexScreener
src/lib/portfolio/     mapping, risk metrics, loadPortfolio()
server/plugin.ts       Vite /api/portfolio and /api/chat in dev + preview
src/lib/ops/           sparks, decision stream, hero ranking
src/lib/ai/            compact book + generateText desk chat
api/                   Vercel routes (`portfolio.js` / `chat.js` bundled from `server/vercel-*.ts`)
```

## Risk rules (edit in the Risk panel / `metrics.ts`)

- Max single name ~15% of equity once size is large
- Keep ≥ 20% cash for new high-conviction entries
- Size down after ~8% drawdown from peak
- Flag size > 10% of pool liquidity

## License

MIT
