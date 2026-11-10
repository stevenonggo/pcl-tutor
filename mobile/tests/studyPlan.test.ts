/// <reference types="jest" />

import { normalizeStudyPlan } from '../src/lib/studyPlan';

describe('normalizeStudyPlan', () => {
  it('passes through a complete plan unchanged', () => {
    const raw = {
      firstSteps: ['Set up the environment', 'Read the syllabus'],
      phases: [
        {
          title: 'Fundamentals',
          topics: ['Limits', 'Derivatives'],
          activities: ['Solve problem sets'],
          milestone: 'Can differentiate',
        },
      ],
      tip: 'Practice daily.',
    };

    const plan = normalizeStudyPlan(raw, { model: 'openai/gpt-4o-mini', source: 'openrouter' });

    expect(plan.firstSteps).toEqual(['Set up the environment', 'Read the syllabus']);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({
      index: 0,
      title: 'Fundamentals',
      topics: ['Limits', 'Derivatives'],
      activities: ['Solve problem sets'],
      milestone: 'Can differentiate',
    });
    expect(plan.tip).toBe('Practice daily.');
    expect(plan.model).toBe('openai/gpt-4o-mini');
    expect(plan.source).toBe('openrouter');
  });

  it('coerces a string topics field into a single-item array', () => {
    const plan = normalizeStudyPlan(
      { phases: [{ title: 'Week 1', topics: 'Only one topic', activities: 'Read the notes' }] },
      {},
    );

    expect(plan.phases[0].topics).toEqual(['Only one topic']);
    expect(plan.phases[0].activities).toEqual(['Read the notes']);
  });

  it('fills in index and title defaults for partial phases', () => {
    const plan = normalizeStudyPlan({ phases: [{}] }, {});

    expect(plan.phases[0]).toEqual({
      index: 0,
      title: 'Phase 1',
      topics: [],
      activities: [],
      milestone: '',
    });
  });

  it('returns an empty plan with defaults for non-object input', () => {
    const plan = normalizeStudyPlan(null, {});

    expect(plan).toEqual({
      firstSteps: [],
      phases: [],
      tip: '',
      model: undefined,
      source: 'ai',
    });
  });

  it('drops non-string entries from arrays and trims empty strings', () => {
    const plan = normalizeStudyPlan(
      { firstSteps: ['Valid', '', ' '], phases: [] },
      {},
    );

    expect(plan.firstSteps).toEqual(['Valid']);
  });
});
