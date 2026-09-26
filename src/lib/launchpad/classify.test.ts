import { describe, expect, it } from 'vitest';
import { DIRECT_LAUNCH, launchpadFromDexIds, launchpadFromMint, narrativesFor } from './classify.ts';
import { metaFromGecko } from './gecko.ts';

describe('launchpad detection', () => {
  it('maps GeckoTerminal dex ids to launchpads', () => {
    expect(launchpadFromDexIds(['uniswap-v4-robinhood', 'pons-v2-dex'])?.label).toBe('Pons');
    expect(launchpadFromDexIds(['bankr-robinhood'])?.label).toBe('Bankr');
    expect(launchpadFromDexIds(['stonkfun'])?.label).toBe('Stonk.fun');
    expect(launchpadFromDexIds(['uniswap-v2-robinhood'])).toBeUndefined();
  });

  it('falls back to Solana vanity mint suffixes', () => {
    expect(launchpadFromMint('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsUpump')?.label).toBe('Pump.fun');
    expect(launchpadFromMint('AbcBONK')?.label).toBe('LetsBonk');
    expect(launchpadFromMint('0xabcpump')).toBeUndefined();
  });

  it('reads launchpad and pairing from GeckoTerminal top pools', () => {
    const pools = new Map([
      [
        'robinhood_0xpool',
        { id: 'robinhood_0xpool', attributes: { name: 'SPY / STOCK' }, relationships: { dex: { data: { id: 'pons-v2-dex' } } } },
      ],
    ]);
    const meta = metaFromGecko(
      {
        attributes: { address: '0x4c11', symbol: 'STOCK', name: 'Stock Tokens' },
        relationships: { top_pools: { data: [{ id: 'robinhood_0xpool' }] } },
      },
      pools,
    );
    expect(meta.launchpad.label).toBe('Pons');
    expect(meta.quote).toBe('SPY');
    expect(meta.narratives).toContain('Stonks');
  });

  it('marks plain DEX launches as direct', () => {
    const meta = metaFromGecko(
      { attributes: { address: '0xd109', symbol: 'TOKENIZATION', name: 'Tokenization Supercycle' } },
      new Map(),
    );
    expect(meta.launchpad).toEqual(DIRECT_LAUNCH);
    expect(meta.narratives).toContain('RWA / tokenization');
  });
});

describe('narrativesFor', () => {
  it('tags stock-paired names as Stonks', () => {
    expect(narrativesFor({ symbol: 'MDOG', name: 'Muse Dog', quote: 'META' })).toEqual([
      'Stonks',
      'Muse',
      'Animals',
    ]);
    expect(narrativesFor({ symbol: 'DEBT', name: 'DebtCoin', quote: 'SGOV' })).toContain('Stonks');
  });

  it('tags agent names and falls back to Other', () => {
    expect(narrativesFor({ symbol: 'JOLLY', name: 'Jollybot' })).toContain('AI / agents');
    expect(narrativesFor({ symbol: 'ZZZ', name: 'Sleepy' })).toEqual(['Other']);
  });
});
