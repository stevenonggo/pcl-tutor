import { readJson, writeJson, STORAGE_KEYS } from './storage';

// The locally persisted AI settings record (the Settings drawer is the only
// writer/reader of this module). It stores ONLY the provider, endpoint and
// model ID picked by the user. The API key is deliberately not part of this
// record: it is validated against the provider and stored encrypted on the
// PCL Tutor backend, and no key material ever reaches localStorage.

export const DEFAULT_AI_CONFIG = Object.freeze({
  provider: 'deepseek',
  endpoint: '',
  model: '',
});

// Permissive model-ID pattern: letters and digits plus the namespace
// characters OpenAI-compatible providers actually use (org/model, dots,
// dashes, underscores) and OpenRouter's qualifier syntax (":free" and
// similar tag suffixes, e.g. "inclusionai/ling-3.2-flash:free"). A single
// character is allowed; the ID must end in a letter or digit, so a dangling
// "id/", "v1." or "id:" is rejected. The pattern is a sanity check for the
// manual input, not a whitelist — any exact ID the provider returns stays
// valid because the user only types what the model list or the provider
// told them to.
export const MODEL_ID_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._:/-]{0,126}[a-zA-Z0-9])?$/;

export function isValidModelId(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed !== '' && MODEL_ID_PATTERN.test(trimmed);
}

/**
 * Coerce any parsed record into a clean `{provider, endpoint, model}`
 * config. Unknown fields (including stray key material) are dropped, so a
 * corrupted or hand-edited record can never persist more than the three
 * known settings.
 */
export function normalizeAiConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pick = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  return {
    provider: pick('provider') || DEFAULT_AI_CONFIG.provider,
    endpoint: pick('endpoint'),
    model: pick('model'),
  };
}

export function loadAiConfig() {
  const raw = readJson(STORAGE_KEYS.aiConfig, null);
  return raw === null ? { ...DEFAULT_AI_CONFIG } : normalizeAiConfig(raw);
}

export function saveAiConfig(config) {
  writeJson(STORAGE_KEYS.aiConfig, normalizeAiConfig(config));
}
