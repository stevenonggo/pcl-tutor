import { readJson, STORAGE_KEYS, writeJson } from './storage';

// Strict UUID-4 shape — mirrors the backend validator in aikeys/identity.py,
// so whatever is sent as the device identity is guaranteed to be accepted.
const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build a UUID-4 from Web Crypto. Prefers `crypto.randomUUID()`; falls back
 * to `getRandomValues()` so older browsers still get a compliant v4.
 * Returns '' only when the browser exposes no Web Crypto implementation at
 * all (the AI endpoints then simply behave as before: JWT-only).
 */
function generateUuid4() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xx)
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return '';
}

/**
 * The PCL Tutor device identity for the AI endpoints: a random UUID-4 that is
 * generated once per browser profile and kept in localStorage — completely
 * independent of PCL Tutor sign-in. Locally registered (no backend account)
 * users therefore still get their own encrypted AI-key storage; when a
 * SimpleJWT is present the backend prefers it and ignores this value.
 *
 * A corrupted stored value is replaced with a fresh UUID-4 rather than sent
 * to the server. Returns '' only when no Web Crypto is available.
 *
 * The identity is never logged or printed anywhere in the UI.
 */
export function getDeviceIdentity() {
  const stored = readJson(STORAGE_KEYS.aiIdentity, null);
  if (typeof stored === 'string' && UUID4_RE.test(stored)) {
    return stored;
  }
  const fresh = generateUuid4();
  if (fresh) {
    writeJson(STORAGE_KEYS.aiIdentity, fresh);
  }
  return fresh;
}
