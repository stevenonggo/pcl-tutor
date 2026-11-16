import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiKeysApiError, fetchAiCredentialStatus, fetchAiModels, fetchAiProviders, validateAiKey } from '../lib/aiKeysApi';
import { getDeviceIdentity } from '../lib/aiIdentity';

// Exercises the service with a mocked global fetch — no real provider calls.
const KEY = 'sk-test-abcdef';

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function storeUser(token) {
  localStorage.setItem('pcl-user-v7', JSON.stringify({ role: 'student', name: 'Test', token }));
}

describe('aiKeysApi', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  it('sends the key and provider to /validate/ with the stored JWT', async () => {
    storeUser('jwt-token-1');
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ valid: true, stored: true, key_hint: 'cdef', message: 'ok' }));

    const result = await validateAiKey({ provider: 'deepseek', apiKey: KEY });

    expect(result.valid).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/ai/validate/');
    expect(JSON.parse(init.body)).toEqual({ provider: 'deepseek', api_key: KEY });
    expect(init.headers.Authorization).toBe('Bearer jwt-token-1');
  });

  it('omits the Authorization header when no token is stored', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ valid: false, stored: false, message: 'no auth' }));
    await validateAiKey({ provider: 'openai', apiKey: KEY });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('passes a custom endpoint override only when one is given', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ valid: true }));
    await validateAiKey({ provider: 'custom', apiKey: KEY, endpoint: ' https://gw.example.com/v1 ' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).endpoint).toBe('https://gw.example.com/v1');
    await validateAiKey({ provider: 'deepseek', apiKey: KEY });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).endpoint).toBeUndefined();
  });

  it('surfaces provider rejections without throwing (valid=false)', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ valid: false, stored: false, message: 'The provider rejected this key (HTTP 401).' }));
    const result = await validateAiKey({ provider: 'modelscope', apiKey: KEY });
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/rejected/i);
  });

  it('throws AiKeysApiError(401) when the session token expired', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ detail: 'Unauthorized' }, { ok: false, status: 401 }));
    let error = null;
    await fetchAiProviders().catch((err) => { error = err; });
    expect(error).toBeInstanceOf(AiKeysApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });

  it('throws AiKeysApiError(0) when the backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    let error = null;
    await fetchAiCredentialStatus().catch((err) => { error = err; });
    expect(error).toBeInstanceOf(AiKeysApiError);
    expect(error.status).toBe(0);
  });

  it('reports stored-credential status without key material', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ configured: true, provider: 'deepseek', key_hint: 'cdef', verified: true, validated_at: '2026-01-01T00:00:00Z' }),
    );
    const status = await fetchAiCredentialStatus();
    expect(status.provider).toBe('deepseek');
    expect(status.key_hint).toBe('cdef');
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it('never persists the key in localStorage', async () => {
    storeUser('jwt-token-1');
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ valid: true, stored: true, key_hint: 'cdef' }));
    await validateAiKey({ provider: 'deepseek', apiKey: KEY });
    for (const value of Object.values(localStorage)) {
      expect(String(value)).not.toContain(KEY);
    }
  });

  it('fetchAiModels POSTs to /ai/models/ with the stored JWT', async () => {
    storeUser('jwt-token-1');
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ provider: 'deepseek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }], error: '' }),
    );

    const result = await fetchAiModels({ endpoint: ' https://gw.example.com/v1 ' });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/ai/models/');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer jwt-token-1');
    expect(JSON.parse(init.body)).toEqual({ endpoint: 'https://gw.example.com/v1' });
    expect(result.models).toEqual([{ id: 'deepseek-chat', name: 'DeepSeek Chat' }]);

    // No endpoint override: the body is an empty object.
    await fetchAiModels();
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({});
  });

  it('omits the Authorization header on /ai/models/ when no token is stored', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ provider: 'deepseek', models: [], error: '' }));
    await fetchAiModels();
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('surfaces AiKeysApiError(401) from status, validate and models when unauthenticated', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ detail: 'Authentication credentials were not provided.' }, { ok: false, status: 401 }),
    );
    const calls = [
      () => fetchAiCredentialStatus(),
      () => validateAiKey({ provider: 'deepseek', apiKey: KEY }),
      () => fetchAiModels(),
    ];
    for (const call of calls) {
      let error = null;
      await call().catch((err) => { error = err; });
      expect(error).toBeInstanceOf(AiKeysApiError);
      expect(error.status).toBe(401);
    }
  });

  it('always sends the local device identity on /ai/status/', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ configured: false }));
    await fetchAiCredentialStatus();
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers['X-PCL-AI-Identity']).toBe(getDeviceIdentity());
    expect(init.headers['X-PCL-AI-Identity']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sends the same device identity on /ai/validate/ and /ai/models/', async () => {
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ provider: 'deepseek', models: [], error: '' }));
    await validateAiKey({ provider: 'deepseek', apiKey: KEY });
    await fetchAiModels();
    const identity = getDeviceIdentity();
    expect(global.fetch.mock.calls[0][1].headers['X-PCL-AI-Identity']).toBe(identity);
    expect(global.fetch.mock.calls[1][1].headers['X-PCL-AI-Identity']).toBe(identity);
  });

  it('keeps the JWT header alongside the device identity when signed in', async () => {
    storeUser('jwt-token-1');
    global.fetch = vi.fn().mockResolvedValue(fakeResponse({ configured: false }));
    await fetchAiCredentialStatus();
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token-1');
    expect(init.headers['X-PCL-AI-Identity']).toBe(getDeviceIdentity());
  });
});

// End-to-end against a local stub that mimics the backend's dual-identity
// gate (valid Bearer JWT OR a well-formed device-identity header -> 200;
// neither -> 401). Proves on the wire that a local, not-signed-in user
// reaches the AI endpoints WITHOUT an Authorization header, and that a
// signed-in user sends both identities at once. Skipped when port 8000 is
// busy.
describe('aiKeysApi against a local auth-gated stub', () => {
  const TOKEN = 'jwt-token-1';
  const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('works without a PCL sign-in and keeps the JWT when signed in', async () => {
    const http = await import('node:http');
    const seenAuth = [];
    const seenIdentity = [];
    const server = http.createServer((req, res) => {
      seenAuth.push(req.headers.authorization || '');
      seenIdentity.push(req.headers['x-pcl-ai-identity'] || '');
      res.setHeader('Content-Type', 'application/json');
      const deviceOk = UUID4.test(req.headers['x-pcl-ai-identity'] || '');
      if (req.headers.authorization !== `Bearer ${TOKEN}` && !deviceOk) {
        res.statusCode = 401;
        res.end(JSON.stringify({ detail: 'Authentication credentials were not provided.' }));
        return;
      }
      res.statusCode = 200;
      if (req.url.includes('/models/')) res.end(JSON.stringify({ provider: 'deepseek', models: [{ id: 'm1', name: 'Model 1' }], error: '' }));
      else if (req.url.includes('/validate/')) res.end(JSON.stringify({ valid: true, stored: true, provider: 'deepseek', key_hint: 'cdef', message: 'ok' }));
      else res.end(JSON.stringify({ configured: false }));
    });
    // Watchdog included: if the bind neither succeeds nor reports EADDRINUSE
    // within a short window, treat it as "port busy" and skip rather than
    // hang the suite. The timer is always cleared, so it holds nothing.
    const listening = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      const settle = (value) => { clearTimeout(timer); resolve(value); };
      const onError = () => settle(false);
      server.once('error', onError);
      server.listen(8000, () => {
        server.removeListener('error', onError);
        settle(true);
      });
    });
    if (!listening) { // Something else owns :8000 — the mocked-fetch tests above still cover the header logic.
      return;
    }
    try {
      const device = getDeviceIdentity();

      // 1. Local user: the stored session has no JWT, so the request goes
      //    out with NO Authorization header — the device identity carries
      //    the request instead and the gate answers 200.
      localStorage.setItem('pcl-user-v7', JSON.stringify({ role: 'student', name: 'Local', token: '' }));
      expect(await fetchAiCredentialStatus()).toEqual({ configured: false });
      expect(seenAuth[0]).toBe('');
      expect(seenIdentity[0]).toBe(device);
      expect((await fetchAiModels()).models).toEqual([{ id: 'm1', name: 'Model 1' }]);
      expect(seenIdentity[1]).toBe(device);

      // 2. Signed-in user: the JWT rides ALONGSIDE the device identity; the
      //    backend prefers the JWT (asserted in the unit tests above).
      storeUser(TOKEN);
      expect(await fetchAiCredentialStatus()).toEqual({ configured: false });
      expect(seenAuth[2]).toBe(`Bearer ${TOKEN}`);
      expect(seenIdentity[2]).toBe(device);
      expect((await validateAiKey({ provider: 'deepseek', apiKey: KEY })).valid).toBe(true);
      expect(seenAuth[3]).toBe(`Bearer ${TOKEN}`);
      expect(seenIdentity[3]).toBe(device);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20_000);
});
