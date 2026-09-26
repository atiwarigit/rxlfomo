const KNOWN: Record<string, { solana?: string; evm?: string }> = {
  busymeredog: {
    solana: '7G4MHQzKBdiMuwW1E2cCpEti8wQDxd8gj8rjS3kyF67b',
    evm: '0x06953a582f054b7b7c4c6dd890777e3958b4a673',
  },
  softmereelk: {
    solana: 'Ei1dmgYK1av31iuQHzpTx4e7vAg5nXxA9mE7x1Gr34Ao',
    evm: '0x455ef47a4dd4e682b08d28bd28fdf68f1de38b81',
  },
};

export function sameHandle(a?: string, b?: string): boolean {
  const norm = (h?: string) => (h || '').replace(/^@/, '').trim().toLowerCase();
  return !norm(a) || !norm(b) || norm(a) === norm(b);
}

/** Public addresses for handles this deployment serves; env vars still win. */
export function knownWallets(handle?: string): { solana: string; evm: string } {
  const row = KNOWN[(handle || '').replace(/^@/, '').toLowerCase()] ?? {};
  return { solana: row.solana || '', evm: row.evm || '' };
}
