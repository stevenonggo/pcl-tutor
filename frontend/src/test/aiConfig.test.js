import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_CONFIG, isValidModelId, loadAiConfig, saveAiConfig } from '../lib/aiConfig';
import { STORAGE_KEYS } from '../lib/storage';

const KEY = STORAGE_KEYS.aiConfig;

beforeEach(() => {
  localStorage.clear();
});

describe('loadAiConfig', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it('restores a previously saved record', () => {
    saveAiConfig({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
    expect(loadAiConfig()).toEqual({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
  });

  it('drops unknown fields so a hand-edited record can only hold the three settings', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        provider: 'openai',
        endpoint: 'https://gw.example/v1',
        model: 'gpt-4o',
        apiKey: 'sk-should-never-persist',
        api_key: 'sk-either',
        token: 'also-no',
      }),
    );
    const config = loadAiConfig();
    expect(config).toEqual({ provider: 'openai', endpoint: 'https://gw.example/v1', model: 'gpt-4o' });
  });

  it('falls back to the defaults for corrupted JSON', () => {
    localStorage.setItem(KEY, '{not-json');
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it('ignores non-object records', () => {
    localStorage.setItem(KEY, JSON.stringify('deepseek'));
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });
});

describe('saveAiConfig', () => {
  it('persists exactly the three known settings', () => {
    saveAiConfig({ provider: 'custom', endpoint: 'https://gw.example/v1', model: 'gw-model' });
    const raw = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(raw).sort()).toEqual(['endpoint', 'model', 'provider']);
  });

  it('never persists key material even when one is handed in', () => {
    saveAiConfig({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-secret' });
    const raw = JSON.parse(localStorage.getItem(KEY));
    expect(raw).not.toHaveProperty('apiKey');
    expect(JSON.stringify(raw)).not.toContain('sk-secret');
  });

  it('normalizes non-string values and blanks to clean strings', () => {
    saveAiConfig({ provider: 42, endpoint: null, model: '  deepseek-chat  ' });
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ provider: 'deepseek', endpoint: '', model: 'deepseek-chat' });
  });
});

describe('isValidModelId', () => {
  it('accepts the model ID shapes providers actually use', () => {
    for (const id of ['gpt-4o', 'deepseek-chat', 'openai/gpt-4o-mini', 'model.v1_x', 'a', 'x'.repeat(128)]) {
      expect(isValidModelId(id), id).toBe(true);
    }
  });

  it('accepts OpenRouter qualifier IDs (the :free suffix)', () => {
    // Regression: ":free" (and similar ":tag" qualifiers) must pass.
    for (const id of [
      'inclusionai/ling-3.2-flash:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'google/gemini-2.0-flash-001:free',
      'model:free',
    ]) {
      expect(isValidModelId(id), id).toBe(true);
    }
  });

  it('rejects empty, padded, and malformed input', () => {
    for (const id of ['', '   ', 'bad id', 'model{', 'id/', 'v1.', null, undefined, 'x'.repeat(129)]) {
      expect(isValidModelId(id), String(id)).toBe(false);
    }
    // A dangling qualifier (or a colon followed by whitespace) is still malformed.
    for (const id of ['inclusionai/ling-3.2-flash:', 'model:', 'a:b:']) {
      expect(isValidModelId(id), id).toBe(false);
    }
    // Numeric IDs are legitimate model IDs: the same string shape passes.
    expect(isValidModelId(12345)).toBe(true);
  });
});
