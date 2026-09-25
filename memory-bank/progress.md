# Progress

- Live `/api/portfolio` aggregator (profile, positions, balances, leaderboard, on-chain holdings, Dex prices)
- Ops floor: header 24h P&L / unrealized / volume / cash / open / decisions, hero cards with linear 24h sparks + last call, size board, decision stream, Dex tape
- Desk chat: `/api/chat` JSON `generateText` via AI SDK + `@ai-sdk/openai`; compact book in the prompt; Sources can attach key/model/base URL
- Unit tests for metrics, FOMO mapping, sparks, stream, heroes, compact book, LLM config
- Operator still needs FOMO_API_KEY / handle to show their FOMO book (no mock fallback)
- LLM will 400 until `LLM_API_KEY` / `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` or a pasted Sources key is present
