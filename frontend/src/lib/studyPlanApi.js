import { buildStudyPlan } from './studyPlan';

// Base URL of the Django backend that proxies OpenRouter for the AI Study Plan.
// Override with VITE_PCL_API_BASE (e.g. to route through a Vite dev proxy or a
// deployed API host). Defaults to the local Django dev server.
const API_BASE = import.meta.env.VITE_PCL_API_BASE || 'http://localhost:8000/api';

const GENERATE_PATH = '/study-plan/generate/';

// Merge the AI result over the local skeleton so every key the existing UI
// expects (phases[].index/topics/activities/milestone, firstSteps, tip) is
// present, regardless of what the model returned.
function normalizePlan(ai, local) {
  const aiPhases = Array.isArray(ai?.phases) ? ai.phases : [];
  const phases = aiPhases.map((phase, index) => ({
    index,
    title: phase?.title || local.phases[index]?.title || `Phase ${index + 1}`,
    topics: Array.isArray(phase?.topics)
      ? phase.topics
      : typeof phase?.topics === 'string' && phase.topics
        ? [phase.topics]
        : local.phases[index]?.topics || [],
    activities: Array.isArray(phase?.activities)
      ? phase.activities
      : local.phases[index]?.activities || [],
    milestone: phase?.milestone || local.phases[index]?.milestone || '',
  }));

  return {
    ...local,
    firstSteps: Array.isArray(ai?.firstSteps) && ai.firstSteps.length ? ai.firstSteps : local.firstSteps,
    phases: phases.length ? phases : local.phases,
    tip: typeof ai?.tip === 'string' && ai.tip ? ai.tip : local.tip,
  };
}

/**
 * Generate a study plan through the backend OpenRouter proxy (AI-only).
 *
 * Resolves to an object shaped like `buildStudyPlan(...)` so the page renders
 * it unchanged: the AI result is merged over the local generator's output,
 * which is used purely as a shape template. On success the result carries
 * `source` (the backend's value, e.g. "openrouter") and `model`.
 *
 * There is no local fallback in this mode: on any failure (backend
 * unreachable, missing API key, provider error, or an unexpected response)
 * the function rejects with a descriptive Error and the page shows an
 * "AI unavailable" message with a Try-again action instead of a plan.
 */
export async function generateStudyPlan(settings) {
  // Shape template only (guarantees every key the page renders). Not a fallback.
  const local = buildStudyPlan(settings);

  let response;
  try {
    response = await fetch(`${API_BASE}${GENERATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: settings.subject,
        topic: settings.topic,
        weeks: settings.weeks,
        level: settings.level,
        goal: settings.goal,
        cadence: settings.cadence,
      }),
    });
  } catch {
    throw new Error('AI generation is currently unavailable — the study-plan backend could not be reached.');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      if (body && body.error) detail = body.error;
    } catch {
      /* response was not JSON — keep the generic HTTP detail */
    }
    throw new Error(
      `AI generation is currently unavailable${detail ? ` — ${detail}` : ` (HTTP ${response.status})`}.`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('AI generation is currently unavailable — the backend returned an unexpected response.');
  }

  return {
    ...normalizePlan(data.plan, local),
    disclaimer: `Live preview — generated with ${data.model || 'OpenRouter'} from your settings.`,
    model: data.model,
    source: data.source || 'ai',
  };
}
