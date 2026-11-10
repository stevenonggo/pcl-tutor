import { describe, expect, it } from 'vitest';
import {
  buildStudyPlan,
  describeStudyPlan,
  PLAN_CADENCES,
  PLAN_GOALS,
  PLAN_LEVELS,
  PLAN_TIMEFRAMES,
} from '../lib/studyPlan';

const base = {
  subject: 'Calculus',
  topic: 'Gradients',
  weeks: '2',
  level: 'Beginner',
  goal: 'Prepare for an exam',
  cadence: 'Moderate (~5 h/week)',
};

describe('buildStudyPlan (local preview generator)', () => {
  it('is deterministic for the same inputs', () => {
    expect(buildStudyPlan(base)).toEqual(buildStudyPlan(base));
  });

  it('builds exactly the requested number of phases (clamped to 1–4)', () => {
    expect(buildStudyPlan({ ...base, weeks: '1' }).phases.length).toBe(1);
    expect(buildStudyPlan({ ...base, weeks: '4' }).phases.length).toBe(4);
    expect(buildStudyPlan({ ...base, weeks: '99' }).phases.length).toBe(4);
    expect(buildStudyPlan({ ...base, weeks: '0' }).phases.length).toBe(2); // falls back to 2
  });

  it('always carries the sample/preview disclaimer in plan and text output', () => {
    const plan = buildStudyPlan(base);
    expect(plan.disclaimer).toMatch(/preview/i);
    expect(plan.disclaimer).toMatch(/not .*live AI/i);
    expect(describeStudyPlan(plan)).toMatch(/preview/i);
  });

  it('uses a generic fallback for subjects without a topic pool', () => {
    const plan = buildStudyPlan({ ...base, subject: 'Not a real subject', weeks: '4' });
    expect(plan.phases.every((phase) => phase.topics.length > 0)).toBe(true);
    expect(plan.phases.every((phase) => phase.activities.length > 0)).toBe(true);
  });

  it('adjusts activities by level, goal and cadence', () => {
    const beginner = buildStudyPlan({ ...base, level: 'Beginner' });
    const advanced = buildStudyPlan({ ...base, level: 'Advanced', goal: 'Prepare for a project' });
    expect(beginner.phases[0].activities.join()).toMatch(/explainer/i);
    expect(advanced.phases[0].activities.join()).toMatch(/extension problem/i);
    expect(advanced.phases[0].activities.join()).toMatch(/project/i);
  });

  it('renders option lists from a single source of truth', () => {
    expect(PLAN_TIMEFRAMES.map((item) => item.value)).toEqual(['1', '2', '4']);
    expect(PLAN_LEVELS).toHaveLength(3);
    expect(PLAN_GOALS).toHaveLength(4);
    expect(PLAN_CADENCES).toHaveLength(3);
  });

  it('produces a readable plain-text outline for copying', () => {
    const text = describeStudyPlan(buildStudyPlan(base));
    expect(text).toContain('Study plan (preview) — Calculus · Gradients');
    expect(text).toContain('Week 1');
    expect(text).toContain('By the end');
  });
});
