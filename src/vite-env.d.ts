/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOMO_HANDLE?: string;
  readonly VITE_SOLANA_WALLET?: string;
  readonly VITE_EVM_WALLET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
