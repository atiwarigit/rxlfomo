# Active context

Live FOMO API + Solana wallet layer is on `cursor/fomo-live-data-c2dd` (PR #1). Mock PnL is gone. Operator still needs to paste FOMO handle + fomoapi.io key (or env) to pull their own book; wallet-only path is verified on-chain.

Replaced `src/data/mockPortfolio.ts` with a live FOMO API + Solana wallet layer. Handle/API key/wallets are configured via `.env` or the Sources panel. Next: wire a real handle once `FOMO_API_KEY` is set, then add trade-journal R-multiples and optional Helius.
