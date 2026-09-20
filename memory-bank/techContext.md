# Tech context

- Vite 6 + React 19 + TypeScript + Tailwind v4 + Recharts
- Unofficial FOMO API: https://api.fomoapi.io (Bearer key required for data)
- Native FOMO `prod-api.fomo.family` is Cloudflare-gated (430 without a Privy session); not used
- Solana: publicnode JSON-RPC or Helius `getAssetsByOwner`
- Prices: DexScreener token pairs, GeckoTerminal for SOL
- Tests: Vitest (`src/**/*.test.ts`)
- Vercel `/api/portfolio` is an esbuild ESM bundle (`npm run build:api` → `api/portfolio.js`) so Node does not import `src/*.ts` at runtime
