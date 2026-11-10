import type { StudyPhase, StudyPlan } from './types';

/** Coerce an unknown value into a trimmed string array (the model may send a lone string). */
function asStringArray(value: unknown): string[] {
  const entries: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? [value]
      : [];
  return entries
    .map((entry) => (typeof entry === 'string' ? entry : String(entry)).trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Normalize a raw OpenRouter plan into the StudyPlan shape the UI renders.
 *
 * The backend asks the model for a fixed JSON schema, but models still
 * drift (string instead of list, missing milestone, ...). Every key the
 * UI expects is guaranteed to exist after this function runs, so no screen
 * ever has to guard against a partial plan.
 */
export function normalizeStudyPlan(
  raw: unknown,
  meta: { model?: string; source?: string },
): StudyPlan {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const rawPhases = Array.isArray(record.phases) ? record.phases : [];
  const phases: StudyPhase[] = rawPhases.map((entry, index) => {
    const phase = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
    return {
      index,
      title: typeof phase.title === 'string' ? phase.title : `Phase ${index + 1}`,
      topics: asStringArray(phase.topics),
      activities: asStringArray(phase.activities),
      milestone: typeof phase.milestone === 'string' ? phase.milestone : '',
    };
  });

  return {
    firstSteps: asStringArray(record.firstSteps),
    phases,
    tip: typeof record.tip === 'string' ? record.tip : '',
    model: meta.model,
    source: meta.source ?? 'ai',
  };
}
