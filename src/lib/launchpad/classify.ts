export interface LaunchpadInfo {
  id: string;
  label: string;
}

const DEX_TO_LAUNCHPAD: Record<string, LaunchpadInfo> = {
  'pons-v2': { id: 'pons', label: 'Pons' },
  'pons-v2-dex': { id: 'pons', label: 'Pons' },
  'pons-dot-family': { id: 'pons', label: 'Pons' },
  'bankr-robinhood': { id: 'bankr', label: 'Bankr' },
  'clanker-robinhood': { id: 'clanker', label: 'Clanker' },
  'virtuals-robinhood': { id: 'virtuals', label: 'Virtuals' },
  hoodit: { id: 'hoodit', label: 'Hoodit' },
  'o1-launchpad-robinhood': { id: 'o1', label: 'O1' },
  'mint-club-robinhood': { id: 'mint-club', label: 'Mint Club' },
  'easya-kickstart-robinhood': { id: 'easya', label: 'EasyA Kickstart' },
  'pump-fun': { id: 'pumpfun', label: 'Pump.fun' },
  pumpswap: { id: 'pumpfun', label: 'Pump.fun' },
  'letsbonk-fun': { id: 'letsbonk', label: 'LetsBonk' },
  'raydium-launchlab': { id: 'launchlab', label: 'Raydium LaunchLab' },
  'bags-fm': { id: 'bags', label: 'Bags' },
  stonkfun: { id: 'stonkfun', label: 'Stonk.fun' },
  'boop-fun': { id: 'boop', label: 'Boop' },
  moonshot: { id: 'moonshot', label: 'Moonshot' },
  moonit: { id: 'moonshot', label: 'Moonshot' },
  heaven: { id: 'heaven', label: 'Heaven' },
  'meteora-dbc': { id: 'meteora-dbc', label: 'Meteora DBC' },
  clanker: { id: 'clanker', label: 'Clanker' },
  'virtuals-base': { id: 'virtuals', label: 'Virtuals' },
  'zora-base': { id: 'zora', label: 'Zora' },
  'four-meme': { id: 'four-meme', label: 'Four.meme' },
};

const MINT_SUFFIX: [string, LaunchpadInfo][] = [
  ['pump', { id: 'pumpfun', label: 'Pump.fun' }],
  ['bonk', { id: 'letsbonk', label: 'LetsBonk' }],
  ['bags', { id: 'bags', label: 'Bags' }],
  ['stonk', { id: 'stonkfun', label: 'Stonk.fun' }],
  ['ansem', { id: 'ansem', label: 'Ansem' }],
  ['moon', { id: 'moonshot', label: 'Moonshot' }],
  ['boop', { id: 'boop', label: 'Boop' }],
];

export const DIRECT_LAUNCH: LaunchpadInfo = { id: 'direct', label: 'Direct / DEX' };

const MAJOR_QUOTES = new Set([
  'SOL', 'WSOL', 'USDC', 'USDT', 'USDG', 'USD1', 'PYUSD', 'ETH', 'WETH', 'WBNB', 'BNB', 'DAI', 'USDS',
]);

/** Unlabelled launches paired against another meme/base token form their own rotation bucket. */
export function pairLaunch(quote?: string): LaunchpadInfo | undefined {
  const q = (quote || '').trim();
  if (!q || MAJOR_QUOTES.has(q.toUpperCase())) return undefined;
  if (isStockTicker(q)) return { id: 'pair:stocks', label: 'Stock pair' };
  return { id: `pair:${q.toLowerCase()}`, label: `${q} pair` };
}

/** Tokenized stock symbols, including wrapper suffixes like NVDAc / TSLAx. */
function isStockTicker(symbol: string): boolean {
  const s = symbol.trim();
  return STOCK_TICKERS.has(s.toUpperCase()) || STOCK_TICKERS.has(s.replace(/[a-z]+$/, '').toUpperCase());
}

export function launchpadFromDexIds(dexIds: string[]): LaunchpadInfo | undefined {
  for (const id of dexIds) {
    const hit = DEX_TO_LAUNCHPAD[id];
    if (hit) return hit;
  }
  return undefined;
}

export function launchpadFromMint(mint?: string): LaunchpadInfo | undefined {
  if (!mint || mint.startsWith('0x')) return undefined;
  const lower = mint.toLowerCase();
  return MINT_SUFFIX.find(([suffix]) => lower.endsWith(suffix))?.[1];
}

const STOCK_TICKERS = new Set([
  'SPY', 'QQQ', 'META', 'TSLA', 'NVDA', 'AAPL', 'AMZN', 'GOOGL', 'GOOG', 'MSFT', 'HOOD', 'AMC',
  'GME', 'COIN', 'MSTR', 'SGOV', 'PLTR', 'NFLX', 'AMD', 'INTC', 'BABA', 'DIS', 'UBER', 'CRCL',
  'IWM', 'DIA', 'TLT', 'GLD', 'SLV', 'ARKK', 'SOFI', 'RDDT', 'SMCI', 'AVGO', 'ORCL',
]);

const NARRATIVES: { tag: string; test: (t: { symbol: string; name: string; quote: string }) => boolean }[] = [
  {
    tag: 'Stonks',
    test: ({ symbol, name, quote }) =>
      (quote !== '' && isStockTicker(quote)) || /stonk|stock/i.test(`${symbol} ${name} ${quote}`),
  },
  { tag: 'NEAR', test: ({ symbol, name, quote }) => /near/i.test(`${symbol} ${name} ${quote}`) },
  {
    tag: 'Privacy',
    test: ({ symbol, name, quote }) => /\b(w?zec|w?xmr)\b|zcash|monero|privacy/i.test(`${symbol} ${name} ${quote}`),
  },
  { tag: 'Muse', test: ({ symbol, name, quote }) => /muse/i.test(`${symbol} ${name} ${quote}`) },
  {
    tag: 'AI / agents',
    test: ({ symbol, name }) => /\b(ai|gpt|agents?|llm)\b|bot|402/i.test(`${symbol} ${name}`),
  },
  {
    tag: 'RWA / tokenization',
    test: ({ symbol, name }) => /tokeniz|rwa|debt|treasur|bond|yield/i.test(`${symbol} ${name}`),
  },
  {
    tag: 'Animals',
    test: ({ symbol, name, quote }) =>
      /dog|doge|cat|bear|frog|pepe|\bape\b|monkey|bull|penguin|inu|shib|wif|bonk|kat\b/i.test(
        `${symbol} ${name} ${quote}`,
      ),
  },
  {
    tag: 'CT figures',
    test: ({ symbol, name }) => /ansem|vlad|tenev|elon|trump|saylor|cz\b/i.test(`${symbol} ${name}`),
  },
];

export function narrativesFor(input: { symbol?: string; name?: string; quote?: string }): string[] {
  const t = { symbol: input.symbol || '', name: input.name || '', quote: input.quote || '' };
  const tags = NARRATIVES.filter((n) => n.test(t)).map((n) => n.tag);
  return tags.length ? tags : ['Other'];
}
