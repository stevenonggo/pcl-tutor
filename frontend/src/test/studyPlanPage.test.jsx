import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STUDENT, renderApp, signInAs } from './helpers';
import { generateStudyPlan } from '../lib/studyPlanApi';

// Only the network call is mocked; the real error classifier and labels stay
// under test so a broken mapping fails these tests.
vi.mock('../lib/studyPlanApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateStudyPlan: vi.fn() };
});

// The full shape the page renders (the API layer normally merges the local
// skeleton over the AI result; the mock has to supply it all).
const planFixture = (model) => ({
  subject: 'Calculus',
  topic: '',
  weeks: 2,
  level: 'Intermediate',
  goal: 'Understand the concepts',
  cadence: 'Moderate (~5 h/week)',
  firstSteps: ['Start with limits'],
  phases: [{
    index: 0,
    title: 'Foundations',
    topics: ['Limits'],
    activities: ['Practice problems'],
    milestone: 'Solve a limit problem',
  }],
  tip: 'Review before each session.',
  disclaimer: 'Live preview — generated with a model from your settings.',
  model,
  source: 'byok-deepseek',
});

// The exact rejection message shape studyPlanApi produces for backend errors.
const backendError = (detail) => `AI generation is currently unavailable — ${detail}.`;

const pickSubject = async (user) => {
  // The Subject field is an unselected dropdown: trigger, then radio option.
  await user.click(await screen.findByRole('button', { name: /subject choose a subject/i }));
  await user.click(await screen.findByRole('radio', { name: 'Calculus' }));
};

const submit = (user) => user.click(screen.getByRole('button', { name: /generate study plan/i }));

describe('study plan generation error handling', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(STUDENT);
    vi.mocked(generateStudyPlan).mockReset();
  });

  it('presents a successful generation as a Live Preview', async () => {
    const user = userEvent.setup();
    vi.mocked(generateStudyPlan).mockResolvedValueOnce(planFixture('deepseek-chat'));

    renderApp('/study-plan');
    await pickSubject(user);
    await submit(user);

    expect(await screen.findByText('Preview plan')).toBeInTheDocument();
    expect(screen.getByText('Live preview.')).toBeInTheDocument();
    expect(screen.getByText(/generated with deepseek-chat/i)).toBeInTheDocument();
    expect(screen.getByText('Start with limits')).toBeInTheDocument();
    expect(document.querySelector('.study-plan-error')).toBeNull();
  });

  it('hides the previous plan after a failed regeneration and names the error class', async () => {
    const user = userEvent.setup();
    vi.mocked(generateStudyPlan)
      .mockResolvedValueOnce(planFixture('openai/gpt-4o-mini'))
      .mockRejectedValueOnce(new Error(backendError('The provider rejected this key. Validate the key again in Settings.')));

    renderApp('/study-plan');
    await pickSubject(user);
    await submit(user);
    expect(await screen.findByText('Start with limits')).toBeInTheDocument(); // first plan shown

    // The same settings now fail (the stored key no longer works).
    await submit(user);
    await screen.findByText('API key problem');
    expect(screen.getByText('AI study plans are currently unavailable.')).toBeInTheDocument();
    expect(screen.getByText(backendError('The provider rejected this key. Validate the key again in Settings.'))).toBeInTheDocument();
    expect(screen.getByText(/your previous plan is kept/i)).toBeInTheDocument();

    // The previous plan's data is preserved but hidden from the result view:
    // no plan card, no "Live preview" claim, no old content.
    expect(screen.queryByText('Start with limits')).not.toBeInTheDocument();
    expect(screen.queryByText('Live preview.')).not.toBeInTheDocument();
    expect(screen.queryByText('Preview plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Foundations')).not.toBeInTheDocument();

    // No silent retry: exactly one request per submit.
    expect(generateStudyPlan).toHaveBeenCalledTimes(2);
  });

  // Each reliably identifiable backend error class, on a fresh page (no
  // previous plan): the banner names the class and shows the backend detail.
  const identifiableCases = [
    ['model not found (404)', 'The provider could not find the selected model (HTTP 404). Check the model ID in Settings, or pick one from the provider\'s model list.', 'Model problem'],
    ['model rejected (400)', 'The provider rejected the request for the selected model (HTTP 400). Check the model ID, or validate a key for this provider in Settings.', 'Model problem'],
    ['invalid key (401/403)', 'The provider rejected this key. Validate the key again in Settings.', 'API key problem'],
    ['no stored key', 'No API key is stored for this account yet. Validate a key in Settings first.', 'API key problem'],
    ['rate limited (429)', 'The provider rate-limited this request (HTTP 429). Try again in a moment.', 'Provider error'],
    ['provider failure (500)', 'The provider could not generate a plan (HTTP 500).', 'Provider error'],
    ['endpoint unreachable', 'The provider endpoint could not be reached.', 'Endpoint or network problem'],
  ];

  it.each(identifiableCases)('identifies %s and shows a clear error', async (name, detail, label) => {
    const user = userEvent.setup();
    vi.mocked(generateStudyPlan).mockRejectedValueOnce(new Error(backendError(detail)));

    renderApp('/study-plan');
    await pickSubject(user);
    await submit(user);

    await screen.findByText(label);
    expect(screen.getByText('AI study plans are currently unavailable.')).toBeInTheDocument();
    expect(screen.getByText(backendError(detail))).toBeInTheDocument();
    // No previous plan exists, so there is nothing kept to mention.
    expect(screen.queryByText(/your previous plan is kept/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Preview plan')).not.toBeInTheDocument();
    expect(generateStudyPlan).toHaveBeenCalledTimes(1); // no retry
  });

  it('recovers on "Try again" after a failure', async () => {
    const user = userEvent.setup();
    vi.mocked(generateStudyPlan)
      .mockRejectedValueOnce(new Error(backendError('The provider rejected this key. Validate the key again in Settings.')))
      .mockResolvedValueOnce(planFixture('deepseek-chat'));

    renderApp('/study-plan');
    await pickSubject(user);
    await submit(user);
    await screen.findByText('API key problem');

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Live preview.')).toBeInTheDocument();
    expect(screen.getByText(/generated with deepseek-chat/i)).toBeInTheDocument();
    expect(document.querySelector('.study-plan-error')).toBeNull();
    expect(generateStudyPlan).toHaveBeenCalledTimes(2); // one per submit
  });
});
