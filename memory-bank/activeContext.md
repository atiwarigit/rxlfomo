# Active context

Ops floor UI + desk chat is the current work: beebots-style header metrics, three hero bags, decision stream, and POST `/api/chat` with an attachable OpenAI-compatible LLM.

Production `https://rxlfomo.vercel.app` still serves the previous live-data dashboard until this branch is on `main`. Do not invent closed-trade PnL. Cash $0 is valid (0 SOL). LLM keys stay server-side or in Sources (`x-llm-api-key`), never `VITE_`.

Next: attach `LLM_API_KEY` (or AI Gateway) on Vercel, merge to `main` so production picks up the floor.
