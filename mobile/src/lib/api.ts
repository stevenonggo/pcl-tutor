import { API_BASE } from './config';
import { clearTokens, getAccess, getRefresh, storeTokens } from './tokens';
import type {
  ActivityItem,
  ApiUser,
  AuthTokens,
  AvailabilitySlot,
  Booking,
  BookingActionPayload,
  BookingPayload,
  CreateSlotPayload,
  LoginPayload,
  Profile,
  ProfileUpdatePayload,
  RegisterPayload,
  StudyPlan,
  StudyPlanSettings,
  TutorDetail,
  TutorSummary,
  UserRole,
} from './types';
import { normalizeStudyPlan } from './studyPlan';

/** Error carrying the HTTP status plus a human-readable backend message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const NETWORK_ERROR_MESSAGE =
  `Cannot reach the PCL Tutor server at ${API_BASE}. ` +
  'Make sure the backend is running, the phone and computer are on the same network, ' +
  'and EXPO_PUBLIC_API_BASE in mobile/.env points to this computer.';

/** Wrap fetch so transport failures become descriptive ApiErrors (status 0). */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
}

function jsonHeaders(withAuth: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) {
    const token = getAccess();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

/**
 * Single-flight access-token refresh: concurrent 401s share one refresh
 * request instead of racing the backend with duplicates.
 */
let inFlightRefresh: Promise<AuthTokens | null> | null = null;

async function refreshAccessToken(): Promise<AuthTokens | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      const refresh = getRefresh();
      if (!refresh) {
        return null;
      }
      try {
        const response = await fetch(`${API_BASE}/token/refresh/`, {
          method: 'POST',
          headers: jsonHeaders(false),
          body: JSON.stringify({ refresh }),
        });
        if (!response.ok) {
          return null;
        }
        const data = (await response.json()) as { access: string };
        // The refresh token itself is rotated only when it expires; the
        // stored refresh value stays valid for the 7-day lifetime.
        return { access: data.access, refresh };
      } catch {
        // Network failure: treat the refresh as failed, keep stored tokens.
        return null;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
  return inFlightRefresh;
}

/**
 * Perform a request that requires authentication. On a 401 the access token
 * is refreshed once and the request is retried; if the refresh is rejected
 * the session is cleared and the original 401 is returned to the caller.
 */
async function authenticatedRequest(
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<Response> {
  const method = init.method ?? 'GET';
  const perform = () =>
    safeFetch(`${API_BASE}${path}`, {
      method,
      headers: jsonHeaders(true),
      body: init.body,
    });

  const response = await perform();
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    clearTokens();
    return response;
  }
  storeTokens(refreshed);
  return perform();
}

/**
 * Build an ApiError from a failed response, preferring the backend's own
 * message (SimpleJWT "detail", the OpenRouter proxy "error", or the first
 * field-error list from DRF serializers).
 */
async function toApiError(response: Response, fallback: string): Promise<ApiError> {
  let detail: unknown;
  try {
    detail = await response.json();
  } catch {
    detail = undefined;
  }

  let message = fallback;
  if (typeof detail === 'string') {
    message = detail;
  } else if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    if (typeof record.detail === 'string') {
      message = record.detail;
    } else if (typeof record.error === 'string') {
      message = record.error;
    } else {
      // DRF serializer errors: { "username": ["..."], "password": ["..."] }
      const firstList = Object.values(record).find(
        (value): value is string[] => Array.isArray(value) && value.length > 0,
      );
      if (firstList) {
        message = firstList.join(' ');
      }
    }
  }
  return new ApiError(message, response.status);
}

/** Perform a JSON GET/POST/... request and parse the body. */
async function requestJson<T>(
  path: string,
  init: { method?: string; body?: string } = {},
  fallback = 'Request failed.',
): Promise<T> {
  const response = await authenticatedRequest(path, init);
  if (!response.ok) {
    throw await toApiError(response, fallback);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** POST /api/register/ - create a Django account (201 on success). */
export async function register(payload: RegisterPayload): Promise<ApiUser> {
  const response = await safeFetch(`${API_BASE}/register/`, {
    method: 'POST',
    headers: jsonHeaders(false),
    body: JSON.stringify({
      username: payload.username.trim(),
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
    }),
  });
  if (!response.ok) {
    throw await toApiError(response, 'Registration failed.');
  }
  const data = (await response.json()) as { user: ApiUser };
  return data.user;
}

/** POST /api/login/ - obtain the SimpleJWT access/refresh pair. */
export async function login(payload: LoginPayload): Promise<AuthTokens> {
  const response = await safeFetch(`${API_BASE}/login/`, {
    method: 'POST',
    headers: jsonHeaders(false),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await toApiError(response, 'Sign-in failed.');
  }
  return (await response.json()) as AuthTokens;
}

/** GET /api/me/ - validate the session and fetch the current account. */
export async function me(): Promise<ApiUser> {
  return requestJson<ApiUser>('/me/', {}, 'Session check failed.');
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** GET /api/profile/ - full profile including role and tutor fields. */
export async function getProfile(): Promise<Profile> {
  return requestJson<Profile>('/profile/', {}, 'Could not load your profile.');
}

/** PATCH /api/profile/ - update editable profile fields. */
export async function updateProfile(payload: ProfileUpdatePayload): Promise<Profile> {
  return requestJson<Profile>(
    '/profile/',
    { method: 'PATCH', body: JSON.stringify(payload) },
    'Could not save your profile.',
  );
}

/** POST /api/profile/become-tutor/ - promote a student to tutor. */
export async function becomeTutor(): Promise<UserRole> {
  const data = await requestJson<{ role: UserRole }>(
    '/profile/become-tutor/',
    { method: 'POST' },
    'Could not switch your account to tutor.',
  );
  return data.role;
}

// ---------------------------------------------------------------------------
// Tutor discovery
// ---------------------------------------------------------------------------

/** GET /api/tutors/ - tutor directory with optional search and subject. */
export async function listTutors(params: { q?: string; subject?: string } = {}): Promise<
  TutorSummary[]
> {
  const search = new URLSearchParams();
  if (params.q?.trim()) {
    search.set('q', params.q.trim());
  }
  if (params.subject?.trim()) {
    search.set('subject', params.subject.trim());
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const data = await requestJson<{ tutors: TutorSummary[] }>(
    `/tutors/${suffix}`,
    {},
    'Could not load tutors.',
  );
  return data.tutors;
}

/** GET /api/tutors/{id}/ - tutor profile plus next-7-day published slots. */
export async function getTutor(tutorId: string): Promise<TutorDetail> {
  return requestJson<TutorDetail>(`/tutors/${tutorId}/`, {}, 'Could not load this tutor.');
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** GET /api/availability/?date= - the signed-in tutor's own slots for a date. */
export async function listAvailability(date: string): Promise<AvailabilitySlot[]> {
  const data = await requestJson<{ date: string; slots: AvailabilitySlot[] }>(
    `/availability/?date=${encodeURIComponent(date)}`,
    {},
    'Could not load availability.',
  );
  return data.slots;
}

/** POST /api/availability/ - publish a slot as the signed-in tutor. */
export async function createAvailabilitySlot(
  payload: CreateSlotPayload,
): Promise<AvailabilitySlot> {
  const data = await requestJson<{ slot: AvailabilitySlot }>(
    '/availability/',
    { method: 'POST', body: JSON.stringify(payload) },
    'Could not publish the slot.',
  );
  return data.slot;
}

/** DELETE /api/availability/{id}/ - remove one of the tutor's own slots. */
export async function deleteAvailabilitySlot(slotId: string): Promise<void> {
  await requestJson<void>(
    `/availability/${slotId}/`,
    { method: 'DELETE' },
    'Could not delete the slot.',
  );
}

// ---------------------------------------------------------------------------
// Booking, requests, sessions, activity
// ---------------------------------------------------------------------------

/** POST /api/sessions/ - create a published-slot or custom-time booking. */
export async function createBooking(payload: BookingPayload): Promise<Booking> {
  const data = await requestJson<{ booking: Booking; replay?: boolean }>(
    '/sessions/',
    { method: 'POST', body: JSON.stringify(payload) },
    'Could not send the booking request.',
  );
  return data.booking;
}

/** GET /api/sessions/ - confirmed sessions for the current role. */
export async function listSessions(): Promise<Booking[]> {
  const data = await requestJson<{ sessions: Booking[] }>(
    '/sessions/',
    {},
    'Could not load your sessions.',
  );
  return data.sessions;
}

/** GET /api/requests/ - role-scoped pending/suggested/cancelled requests. */
export async function listRequests(): Promise<Booking[]> {
  const data = await requestJson<{ requests: Booking[] }>(
    '/requests/',
    {},
    'Could not load your requests.',
  );
  return data.requests;
}

/** POST /api/sessions/{id}/actions/ - confirm, decline, suggest, or cancel. */
export async function sessionAction(
  sessionId: string,
  payload: BookingActionPayload,
): Promise<Booking> {
  const data = await requestJson<{ booking: Booking }>(
    `/sessions/${sessionId}/actions/`,
    { method: 'POST', body: JSON.stringify(payload) },
    'Could not update the request.',
  );
  return data.booking;
}

/** GET /api/activity/ - derived notification feed for the current role. */
export async function listActivity(): Promise<ActivityItem[]> {
  const data = await requestJson<{ activity: ActivityItem[] }>(
    '/activity/',
    {},
    'Could not load activity.',
  );
  return data.activity;
}

/**
 * POST /api/study-plan/generate/ - generate a plan through the backend's
 * OpenRouter proxy. The endpoint is unauthenticated in Phase 1 (documented
 * security risk, see docs/study-plan-security-risk.md), so it is called
 * without a token on purpose.
 *
 * The backend answers 502/503 with `fallback: true` when OpenRouter is
 * missing or failing; callers surface that as an "AI unavailable" state.
 */
export async function generateStudyPlan(settings: StudyPlanSettings): Promise<StudyPlan> {
  const response = await safeFetch(`${API_BASE}/study-plan/generate/`, {
    method: 'POST',
    headers: jsonHeaders(false),
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw await toApiError(response, 'Study plan generation failed.');
  }
  const data = (await response.json()) as {
    plan: unknown;
    model?: string;
    source?: string;
  };
  const plan = normalizeStudyPlan(data.plan, { model: data.model, source: data.source });
  plan.disclaimer = data.model
    ? `Live preview - generated with ${data.model} from your settings.`
    : undefined;
  return plan;
}
