# Active context

Ops floor + desk chat is live on `https://rxlfomo.vercel.app` (main fast-forwarded to `cursor/ops-floor-chat-c2dd`).

Blocker: fomoapi.io account is out of credits (402), and no Solana wallet is stored anywhere, so production returns an empty book. Loader now stops after the first 402, never writes $0 into the local peak/curve, and remembers any wallet it resolves in the browser.

BusyMereDog's Solana wallet (`7G4MHQ…F67b`) is only a USDC hub; FOMO bridges through Relay to Robinhood chain (4663) EVM `0x0695…a673`, where the bags live. The loader now reads Relay's public `/requests/v2` directly (no FOMO credits, backoff on 429) and `server/knownWallets.ts` defaults those addresses for the handle when env is empty. Book ≈ $620–630 across ~12 Robinhood names on 2026-09-26.

Next: operator tops up fomoapi.io or sets `SOLANA_WALLET` on Vercel / pastes it in Sources; attach `LLM_API_KEY` (or AI Gateway) for chat.

Launchpad + narrative rotation (2026-09-26): each token is tagged from GeckoTerminal `tokens/multi?include=top_pools` dex ids (pons-v2-dex → Pons, bankr-robinhood → Bankr, stonkfun → Stonk.fun, pump-fun, letsbonk-fun, bags-fm…), with Solana mint-suffix fallback. Narratives are keyword + pairing tags (stock-paired = Stonks, Muse, AI/agents, RWA, Animals, CT figures). Relay history now also yields closed trades (sells matched only against buys inside the window). Rotation panel rolls up open size, size-weighted 24h, unrealized, realized, wins per launchpad / narrative.

Multi-handle (2026-09-26): default wallets (`SOLANA_WALLET` env, `server/knownWallets.ts`) only apply when the requested handle is the default handle. The browser keeps resolved wallets, peak, and equity log per handle (legacy global keys migrate to busymeredog); `?handle=` and the header switcher change books. @SoftMereElk still needs a wallet: fomoapi.io is out of credits and fomo.family profile pages are an empty SPA shell.

@SoftMereElk (2026-09-26): Solana `Ei1dmg…34Ao`, EVM `0x455e…8b81` (from Relay). ~$345k book, mostly Solana tokens on plain Raydium pools paired against another token (STONK, wNEAR, ZEC, $WIF…). Unlabelled pools paired against a non-major token now bucket as "<QUOTE> pair" (stock tickers → "Stock pair"); narratives also read the pairing (STONK → Stonks, NEAR, ZEC/XMR → Privacy).

Drip vs active trade (2026-09-26): `src/lib/wallet/drip.ts` samples the last 25 txs of the owner's token account for any Solana holding that other holdings pair against (batched RPC). Receipt with nothing spent = drip (distributor wallets batch-send to ~17 holders); spending another token = buy. Holdings become `drip-reward` (e.g. NEAR), `drip-pair` (e.g. NEARKAT pays NEAR), or `trade`; drip/day is split across paying pairs by size. GeckoTerminal 429s now retry and fall back to DexScreener's quote symbol. BusyMereDog's Solana wallet is now `3bkw…mfxR` (same EVM).
Load budget: Relay paging stops at 15s, GeckoTerminal at 32s, drip sampling at 44s (Vercel functions die at 60s). Drip detection runs in parallel with GeckoTerminal using DexScreener's pairing. SoftMereElk cold loads ~45–55s, warm ~25s.
