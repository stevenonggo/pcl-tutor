import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { generateStudyPlan } from '../lib/studyPlanApi';
import { STORAGE_KEYS } from '../lib/storage';

const settings = {
  subject: 'Calculus',
  topic: 'Gradients',
  weeks: '2',
  level: 'Beginner',
  goal: 'Prepare for an exam',
  cadence: 'Moderate (~5 h/week)',
};

// A deterministic UUID-4 so the device-identity header is exactly assertable.
const DEVICE_ID = '1b9e8c1e-2f3a-4d5e-8f01-2a3b4c5d6e7f';
const JWT = 'jwt-test-token';

const PLAN_BODY = {
  plan: {
    firstSteps: ['Start with limits'],
    phases: [{ title: 'Foundations', topics: ['Limits'], activities: ['Practice'], milestone: 'Solve a problem' }],
    tip: 'Review before each session.',
  },
};

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function lastCall() {
  return global.fetch.mock.calls.at(-1);
}

function lastBody() {
  return JSON.parse(lastCall()[1].body);
}

function lastHeaders() {
  return lastCall()[1].headers;
}

// Exercises the service with a mocked global fetch — no real network or provider
// calls are made.
describe('generateStudyPlan (AI-only mode)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    // A known device identity, so BYOK header assertions are exact.
    localStorage.setItem(STORAGE_KEYS.aiIdentity, JSON.stringify(DEVICE_ID));
  });

  afterEach(() => {
    localStorage.clear();
    global.fetch = originalFetch;
  });

  it('resolves the AI plan and preserves the backend source + model', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({
        ...PLAN_BODY,
        model: 'openai/gpt-4o-mini',
        source: 'openrouter',
      }),
    );

    const result = await generateStudyPlan(settings);

    expect(result.source).toBe('openrouter');
    expect(result.model).toBe('openai/gpt-4o-mini');
    expect(result.subject).toBe('Calculus'); // merged from the local shape template
    expect(result.firstSteps).toEqual(['Start with limits']);
    expect(result.phases[0].index).toBe(0); // normalised index
    expect(result.phases[0].title).toBe('Foundations');
    expect(result.disclaimer).toMatch(/live preview/i);
    expect(global.fetch).toHaveBeenCalledTimes(1); // single request, no retry/fallback
  });

  it('rejects (no local fallback) when the backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    let message = '';
    await generateStudyPlan(settings).catch((err) => {
      message = err.message;
    });

    expect(message).toMatch(/unavailable/i);
    expect(message).toMatch(/could not be reached/i);
  });

  it('rejects with the backend detail when the API key is missing (503)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse({ error: 'OPENROUTER_API_KEY is not configured.', fallback: true }, { ok: false, status: 503 }));

    let message = '';
    await generateStudyPlan(settings).catch((err) => {
      message = err.message;
    });

    expect(message).toMatch(/unavailable/i);
    expect(message).toMatch(/OPENROUTER_API_KEY/i);
  });

  it('rejects when the AI provider errors upstream (502)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse({ error: 'OpenRouter returned 500: rate limited.', fallback: true }, { ok: false, status: 502 }));

    let message = '';
    await generateStudyPlan(settings).catch((err) => {
      message = err.message;
    });

    expect(message).toMatch(/unavailable/i);
    expect(message).toMatch(/rate limited/i);
  });

  it('keeps the legacy path byte-identical when no model is configured', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ ...PLAN_BODY, model: 'openai/gpt-4o-mini', source: 'openrouter' }),
    );

    await generateStudyPlan(settings);

    // No model/endpoint fields, no identity headers: exactly the historical request.
    const body = lastBody();
    expect(body).toEqual({
      subject: settings.subject,
      topic: settings.topic,
      weeks: settings.weeks,
      level: settings.level,
      goal: settings.goal,
      cadence: settings.cadence,
    });
    const headers = lastHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    expect('Authorization' in headers).toBe(false);
    expect('X-PCL-AI-Identity' in headers).toBe(false);
  });
});

describe('generateStudyPlan (BYOK mode — persisted AI settings drive the request)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.aiIdentity, JSON.stringify(DEVICE_ID));
  });

  afterEach(() => {
    localStorage.clear();
    global.fetch = originalFetch;
  });

  it('sends the exact selected model and the device identity, not the .env model', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'deepseek', endpoint: '', model: 'deepseek-chat' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ ...PLAN_BODY, model: 'deepseek-chat', source: 'byok-deepseek' }),
    );

    const result = await generateStudyPlan(settings);

    expect(lastBody().model).toBe('deepseek-chat'); // the exact selected model
    expect(lastBody().endpoint).toBeUndefined(); // no custom endpoint configured
    expect(lastHeaders()['X-PCL-AI-Identity']).toBe(DEVICE_ID);
    expect(result.source).toBe('byok-deepseek');
    expect(result.model).toBe('deepseek-chat');
  });

  it('sends the custom endpoint when one is configured', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'custom', endpoint: 'https://gw.example/v1', model: 'gw-model-x' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ ...PLAN_BODY, model: 'gw-model-x', source: 'byok-custom' }),
    );

    await generateStudyPlan(settings);

    expect(lastBody().model).toBe('gw-model-x');
    expect(lastBody().endpoint).toBe('https://gw.example/v1');
  });

  it('preserves the JWT when a PCL Tutor session exists (JWT + device ride together)', async () => {
    localStorage.setItem(STORAGE_KEYS.legacyUser, JSON.stringify({ token: JWT }));
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'openai', endpoint: '', model: 'gpt-4o-mini' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ ...PLAN_BODY, model: 'gpt-4o-mini', source: 'byok-openai' }),
    );

    await generateStudyPlan(settings);

    expect(lastHeaders().Authorization).toBe(`Bearer ${JWT}`);
    expect(lastHeaders()['X-PCL-AI-Identity']).toBe(DEVICE_ID);
  });

  it('surfaces the missing-credential error clearly (no silent .env fallback)', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'deepseek', endpoint: '', model: 'deepseek-chat' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse(
        { error: 'No API key is stored for this account yet. Validate a key in Settings first.', fallback: true },
        { ok: false, status: 400 },
      ),
    );

    let message = '';
    await generateStudyPlan(settings).catch((err) => {
      message = err.message;
    });

    expect(message).toMatch(/No API key is stored for this account/i);
    expect(message).toMatch(/Validate a key in Settings/i);
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry, no legacy fallback
  });

  it('surfaces upstream provider errors clearly', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'deepseek', endpoint: '', model: 'deepseek-chat' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse(
        { error: 'The provider rejected this key. Validate the key again in Settings.', fallback: true },
        { ok: false, status: 502 },
      ),
    );

    let message = '';
    await generateStudyPlan(settings).catch((err) => {
      message = err.message;
    });

    expect(message).toMatch(/The provider rejected this key/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never puts key material in the request — only the model/endpoint settings', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'deepseek', endpoint: '', model: 'deepseek-chat' }),
    );
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({ ...PLAN_BODY, model: 'deepseek-chat', source: 'byok-deepseek' }),
    );

    await generateStudyPlan(settings);

    // Whatever the stored credential holds on the server, nothing key-like
    // may travel from the browser: the body carries settings only.
    const serialized = JSON.stringify(lastCall()[1]);
    expect(serialized).not.toMatch(/api[_-]?key|sk-[a-z0-9]+/i);
  });
});
