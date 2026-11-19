import { getDeviceIdentity } from './aiIdentity';
import { readJson, STORAGE_KEYS } from './storage';

// Base URL of the Django backend, resolved exactly like studyPlanApi.js /
// authApi.js: VITE_PCL_API_BASE wins, the local Django dev server is the
// default.
const API_BASE = import.meta.env.VITE_PCL_API_BASE || 'http://localhost:8000/api';

/**
 * Error for AI-credential API failures. `status` is the HTTP status when the
 * backend answered, 0 when the network itself failed.
 */
export class AiKeysApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AiKeysApiError';
    this.status = status;
  }
}

/**
 * The SimpleJWT access token the app stored at sign-in (profileToAccount
 * keeps it on the persisted user). Empty when the session predates token
 * storage or the user signed up locally.
 */
function getStoredToken() {
  const user = readJson(STORAGE_KEYS.legacyUser, null);
  return user && typeof user.token === 'string' ? user.token : '';
}

function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The identity headers for every AI endpoint: the PCL Tutor JWT when one is
 * stored (the backend always prefers it), plus the local device identity so
 * un-logged-in / locally registered users still reach their own encrypted
 * AI-key storage. The device value is omitted entirely when no Web Crypto
 * implementation exists, leaving the old JWT-only behavior.
 *
 * Exported so other backend integrations (the BYOK study-plan request)
 * attach the exact same identity headers as the AI settings endpoints.
 * Neither value is logged or printed.
 */
export function buildAiAuthHeaders() {
  const headers = { ...authHeaders() };
  const deviceIdentity = getDeviceIdentity();
  if (deviceIdentity) headers['X-PCL-AI-Identity'] = deviceIdentity;
  return headers;
}

async function requestJson(path, { method = 'GET', body } = {}) {
  const headers = buildAiAuthHeaders();
  const init = { method, headers };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new AiKeysApiError(
      'The PCL Tutor backend could not be reached for AI settings.',
      0,
    );
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON error body — the HTTP status is the detail */
  }
  if (!response.ok) {
    const detail = data && (data.error || data.detail)
      ? String(data.error || data.detail)
      : `The request failed with HTTP ${response.status}.`;
    throw new AiKeysApiError(detail, response.status);
  }
  return data;
}

/** The supported providers (id + label) for the settings UI. */
export function fetchAiProviders() {
  return requestJson('/ai/providers/');
}

/**
 * Validate a user-supplied key against the selected provider and store it
 * encrypted on the server when valid.
 *
 * The key travels only to the backend in this one request; it is never
 * kept in localStorage and is not part of the response.
 */
export function validateAiKey({ provider, apiKey, endpoint }) {
  const body = { provider, api_key: apiKey };
  if (endpoint && endpoint.trim()) body.endpoint = endpoint.trim();
  return requestJson('/ai/validate/', { method: 'POST', body });
}

/** What (if anything) is stored for the signed-in user — no key material. */
export function fetchAiCredentialStatus() {
  return requestJson('/ai/status/');
}

/**
 * List the models available through the user's stored key (discovery only).
 *
 * The backend decrypts the credential server-side for the duration of this
 * request and calls the provider's OpenAI-compatible `/models` route; the
 * response is normalized `{id, name}` entries. No key material ever reaches
 * the browser. Like every other call in this module it goes through
 * `requestJson`, so the stored SimpleJWT access token is attached as
 * `Authorization: Bearer <token>` (a 401 surfaces as AiKeysApiError(401)).
 */
export function fetchAiModels({ endpoint } = {}) {
  const body = {};
  if (endpoint && endpoint.trim()) body.endpoint = endpoint.trim();
  return requestJson('/ai/models/', { method: 'POST', body });
}

/**
 * Verify a model ID against the user's stored key.
 *
 * The key is never re-sent by the browser: the backend decrypts the stored
 * credential and pings the provider's OpenAI-compatible `/chat/completions`
 * route with a single token. No key material ever reaches the browser.
 * Resolves to `{ valid, model, message }`; a provider rejection is `valid:
 * false` (HTTP 200), while an unreachable backend / bad auth surfaces as
 * AiKeysApiError.
 */
export function validateAiModel({ model, endpoint }) {
  const body = { model };
  if (endpoint && endpoint.trim()) body.endpoint = endpoint.trim();
  return requestJson('/ai/validate-model/', { method: 'POST', body });
}
