# Active context

Ops floor + desk chat is live on `https://rxlfomo.vercel.app` (main fast-forwarded to `cursor/ops-floor-chat-c2dd`).

Blocker: fomoapi.io account is out of credits (402), and no Solana wallet is stored anywhere, so production returns an empty book. Loader now stops after the first 402, never writes $0 into the local peak/curve, and remembers any wallet it resolves in the browser.

Next: operator tops up fomoapi.io or sets `SOLANA_WALLET` on Vercel / pastes it in Sources; attach `LLM_API_KEY` (or AI Gateway) for chat.
