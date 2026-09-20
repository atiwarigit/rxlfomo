# System patterns

- `loadPortfolio()` is the single aggregator. UI never talks to fomoapi.io or RPC directly.
- `/api/portfolio` (Vite middleware in dev, `api/portfolio.ts` on Vercel) keeps the FOMO key off the bundle.
- FOMO failures degrade to wallet-only instead of showing mock data.
- SOL + stables = cash; other tokens = open risk. DexScreener liquidity is attached when available.
- Peak equity and daily curve points persist in localStorage so drawdown/equity history compounds.
