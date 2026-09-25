export default function handler(
  _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  res.status(200).json({
    handle: process.env.FOMO_HANDLE || process.env.VITE_FOMO_HANDLE || '',
    hasApiKey: Boolean(process.env.FOMO_API_KEY || process.env.VITE_FOMO_API_KEY),
    hasLlmKey: Boolean(
      process.env.LLM_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY,
    ),
    solanaWallet: process.env.SOLANA_WALLET || process.env.VITE_SOLANA_WALLET || '',
    evmWallet: process.env.EVM_WALLET || process.env.VITE_EVM_WALLET || '',
  });
}
