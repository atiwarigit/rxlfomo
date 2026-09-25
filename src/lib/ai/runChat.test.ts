import { describe, expect, it } from 'vitest';
import { ChatConfigError, resolveLlmConfig, runPortfolioChat } from './runChat.ts';

describe('resolveLlmConfig', () => {
  it('prefers the browser header key, then LLM_API_KEY', () => {
    expect(
      resolveLlmConfig(
        { LLM_API_KEY: 'server', AI_GATEWAY_API_KEY: 'gw', OPENAI_API_KEY: 'oai' },
        'pasted',
      ).apiKey,
    ).toBe('pasted');
    expect(resolveLlmConfig({ LLM_API_KEY: 'server', OPENAI_API_KEY: 'oai' }).apiKey).toBe('server');
    expect(resolveLlmConfig({ AI_GATEWAY_API_KEY: 'gw' }).apiKey).toBe('gw');
  });

  it('defaults the model to gpt-5.4', () => {
    expect(resolveLlmConfig({}).model).toBe('gpt-5.4');
    expect(resolveLlmConfig({ LLM_MODEL: 'gpt-4.1' }).model).toBe('gpt-4.1');
  });
});

describe('runPortfolioChat', () => {
  it('refuses to call a model without a key', async () => {
    await expect(
      runPortfolioChat({ messages: [{ role: 'user', content: 'hi' }], apiKey: '' }),
    ).rejects.toBeInstanceOf(ChatConfigError);
  });
});
