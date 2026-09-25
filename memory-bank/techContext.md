# Tech context

- Vite 6 + React 19 + TypeScript + Tailwind v4 + Recharts
- Unofficial FOMO API: https://api.fomoapi.io (Bearer key required for data)
- Native FOMO `prod-api.fomo.family` is Cloudflare-gated (430 without a Privy session); not used
- Solana: publicnode JSON-RPC or Helius `getAssetsByOwner`
- Prices: DexScreener token pairs, GeckoTerminal for SOL
- Tests: Vitest (`src/**/*.test.ts`)
- Vercel `/api/portfolio` and `/api/chat` are esbuild ESM bundles (`npm run build:api`) so Node does not import `src/*.ts` at runtime
- Desk chat: `ai` + `@ai-sdk/openai` `generateText`; keys `LLM_API_KEY` / `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` or `x-llm-api-key`
