# System patterns

- `loadPortfolio()` is the single aggregator. UI never talks to fomoapi.io or RPC directly.
- `/api/portfolio` (Vite middleware in dev, bundled `api/portfolio.js` on Vercel) keeps the FOMO key off the bundle. Vercel Node cannot import `src/*.ts` from `/api`, so `npm run build:api` esbuilds `server/vercel-portfolio.ts` into a single ESM file.
- FOMO failures degrade to wallet-only instead of showing mock data.
- SOL + stables = cash; other tokens = open risk. DexScreener 24h change is the live mark when FOMO has no cost basis. Spotlight + Relay fills entry/unrealized. Don't treat missing basis as $0 PnL.
- Peak equity and daily curve points persist in localStorage so drawdown/equity history compounds.
