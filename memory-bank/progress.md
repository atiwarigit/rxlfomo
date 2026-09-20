# Progress

- Live `/api/portfolio` aggregator (profile, positions, balances, leaderboard, on-chain holdings, Dex prices)
- Dashboard wired to that snapshot: alerts, PnL windows, open/closed tables, local equity log
- Unit tests for metrics + FOMO mapping; browser smoke test on a real Solana wallet
- Operator still needs FOMO_API_KEY / handle to show their FOMO book (no mock fallback)
- Production crash: Vercel `/api/portfolio` FUNCTION_INVOCATION_FAILED — bundling the handler so it no longer imports `src/*.ts` at runtime
