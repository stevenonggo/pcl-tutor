import { buildStudyPlan } from './studyPlan';
import { loadAiConfig } from './aiConfig';
import { buildAiAuthHeaders } from './aiKeysApi';

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
 * Generate a study plan through the backend proxy.
 *
 * Two paths, decided by the persisted AI settings (`pcl-ai-config-v1`):
 *
 * - BYOK: when the user picked a model in Settings, the request carries
 *   that exact model (plus the custom endpoint when one is configured)
 *   and the identity headers (JWT when signed in, otherwise the local
 *   device identity). The backend resolves the stored, encrypted
 *   credential for that owner, decrypts it server-side, and generates
 *   the plan with the selected model. There is no fallback to the
 *   server's .env key/model: a missing or invalid credential is a
 *   clear error, surfaced verbatim.
 * - Legacy: with no model configured the request is byte-for-byte the
 *   historical one (no model field, no identity headers) and runs the
 *   server OpenRouter flow.
 *
 * Resolves to an object shaped like `buildStudyPlan(...)` so the page
 * renders it unchanged: the AI result is merged over the local
 * generator's output, which is used purely as a shape template. On
 * success the result carries `source` (e.g. "openrouter",
 * "byok-deepseek") and the exact `model` used.
 *
 * There is no local fallback in this mode: on any failure the function
 * rejects with a descriptive Error and the page shows an "AI
 * unavailable" message with a Try-again action instead of a plan.
 * No API key material ever reaches the browser storage, logs, or
 * responses — only the user's own selected model/endpoint settings do.
 */
export async function generateStudyPlan(settings) {
  // Shape template only (guarantees every key the page renders). Not a fallback.
  const local = buildStudyPlan(settings);

  // The persisted AI settings decide which path this request takes.
  const aiConfig = loadAiConfig();
  const byokModel = aiConfig.model; // trimmed string; '' when nothing was picked

  const body = {
    subject: settings.subject,
    topic: settings.topic,
    weeks: settings.weeks,
    level: settings.level,
    goal: settings.goal,
    cadence: settings.cadence,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (byokModel) {
    // BYOK: the exact selected model, and the custom endpoint when the
    // user configured one (built-in providers use their catalogue base).
    body.model = byokModel;
    if (aiConfig.endpoint) body.endpoint = aiConfig.endpoint;
    // Identify the credential owner: JWT when a PCL Tutor session is
    // stored, otherwise the login-independent device identity.
    Object.assign(headers, buildAiAuthHeaders());
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${GENERATE_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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

// The short categories a study-plan failure can be identified as, matched
// against the backend's exact BYOK / legacy / SSRF messages (no key material,
// no network involved — pure string classification).
export const AI_ERROR_KINDS = Object.freeze({
  'api-key': 'API key problem',
  model: 'Model problem',
  endpoint: 'Endpoint or network problem',
  provider: 'Provider error',
});

export function classifyAiPlanError(message) {
  const text = String(message ?? '');
  if (/rejected this key|no api key is stored|credential could not be read/i.test(text)) return 'api-key';
  if (/selected model|check the model id/i.test(text)) return 'model';
  if (/rate-limited|rate limited/i.test(text)) return 'provider';
  if (/endpoint|could not be reached/i.test(text)) return 'endpoint';
  if (/could not generate a plan/i.test(text)) return 'provider';
  return 'unknown';
}
