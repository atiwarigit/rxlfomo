# Active context

Production `https://rxlfomo.vercel.app` loaded the SPA but `/api/portfolio` crashed with FUNCTION_INVOCATION_FAILED (`A server error has occurred`) because `api/portfolio.ts` imported `src/lib/**/*.ts`. Health/defaults worked (no src imports). Fix: bundle the Node handler with esbuild into `api/portfolio.js`. Client `fetch` now tolerates non-JSON error bodies.

Next: confirm the Vercel redeploy shows @BusyMereDog; trade-journal R-multiples once closed history is flowing.
