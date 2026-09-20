# Progress

- Live `/api/portfolio` aggregator (profile, positions, balances, leaderboard, on-chain holdings, Dex prices)
- Dashboard wired to that snapshot: alerts, PnL windows, open/closed tables, local equity log
- Unit tests for metrics + FOMO mapping; browser smoke test on a real Solana wallet
- Operator still needs FOMO_API_KEY / handle to show their FOMO book (no mock fallback)
- Live FOMO + wallet book on production; PnL windows and unrealized now use spotlight/Relay cost basis and Dex 24h when FOMO has no tape
