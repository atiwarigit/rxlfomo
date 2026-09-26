const KNOWN: Record<string, { solana?: string; evm?: string }> = {
  busymeredog: {
    solana: '7G4MHQzKBdiMuwW1E2cCpEti8wQDxd8gj8rjS3kyF67b',
    evm: '0x06953a582f054b7b7c4c6dd890777e3958b4a673',
  },
};

/** Public addresses for handles this deployment serves; env vars still win. */
export function knownWallets(handle?: string): { solana: string; evm: string } {
  const row = KNOWN[(handle || '').replace(/^@/, '').toLowerCase()] ?? {};
  return { solana: row.solana || '', evm: row.evm || '' };
}
