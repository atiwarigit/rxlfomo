# Active context

Ops floor + desk chat is live on `https://rxlfomo.vercel.app` (main fast-forwarded to `cursor/ops-floor-chat-c2dd`).

Blocker: fomoapi.io account is out of credits (402), and no Solana wallet is stored anywhere, so production returns an empty book. Loader now stops after the first 402, never writes $0 into the local peak/curve, and remembers any wallet it resolves in the browser.

BusyMereDog's Solana wallet (`7G4MHQ…F67b`) is only a USDC hub; FOMO bridges through Relay to Robinhood chain (4663) EVM `0x0695…a673`, where the bags live. The loader now reads Relay's public `/requests/v2` directly (no FOMO credits, backoff on 429) and `server/knownWallets.ts` defaults those addresses for the handle when env is empty. Book ≈ $620–630 across ~12 Robinhood names on 2026-09-26.

Next: operator tops up fomoapi.io or sets `SOLANA_WALLET` on Vercel / pastes it in Sources; attach `LLM_API_KEY` (or AI Gateway) for chat.
