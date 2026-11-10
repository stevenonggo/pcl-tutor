import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateStudyPlan } from '../lib/studyPlanApi';

const settings = {
  subject: 'Calculus',
  topic: 'Gradients',
  weeks: '2',
  level: 'Beginner',
  goal: 'Prepare for an exam',
  cadence: 'Moderate (~5 h/week)',
};

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

// Exercises the service with a mocked global fetch — no real network or provider
// calls are made.
describe('generateStudyPlan (AI-only mode)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves the AI plan and preserves the backend source + model', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({
        plan: {
          firstSteps: ['Start with limits'],
          phases: [{ title: 'Foundations', topics: ['Limits'], activities: ['Practice'], milestone: 'Solve a problem' }],
          tip: 'Review before each session.',
        },
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
});
