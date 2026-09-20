import { useState } from 'react';
import type { ClientConfig } from '../lib/localJournal';

interface Props {
  config: ClientConfig;
  open: boolean;
  onClose: () => void;
  onSave: (cfg: ClientConfig) => void;
}

export function SettingsPanel({ config, open, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(config);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60">
      <button className="h-full flex-1 cursor-default" onClick={onClose} aria-label="Close settings" />
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#0d1220] p-5 shadow-2xl">
        <h2 className="text-lg font-semibold">Data sources</h2>
        <p className="mt-1 text-sm text-white/50">
          FOMO API (fomoapi.io) for handle → wallets, PnL, trades, and social stats. Your Solana
          wallet is marked to market on-chain via RPC + DexScreener so paper gains on illiquid
          names get a second look.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <label className="block text-sm">
            <span className="text-white/60">FOMO handle</span>
            <input
              value={draft.handle}
              onChange={(e) => setDraft({ ...draft, handle: e.target.value.replace(/^@/, '') })}
              placeholder="yourhandle"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 outline-none focus:border-emerald-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-white/60">FOMO API key</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="Bearer key from fomoapi.io/dashboard"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 outline-none focus:border-emerald-400"
            />
            <span className="mt-1 block text-xs text-white/40">
              Free key is enough to start. Stored in this browser only; also accepted as FOMO_API_KEY on the server.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-white/60">Solana wallet (optional override)</span>
            <input
              value={draft.solanaWallet}
              onChange={(e) => setDraft({ ...draft, solanaWallet: e.target.value.trim() })}
              placeholder="Filled from FOMO when the handle resolves"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-400"
            />
          </label>
          <label className="block text-sm">
            <span className="text-white/60">EVM wallet (optional)</span>
            <input
              value={draft.evmWallet}
              onChange={(e) => setDraft({ ...draft, evmWallet: e.target.value.trim() })}
              placeholder="0x…"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-400"
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
            >
              Save & load
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
