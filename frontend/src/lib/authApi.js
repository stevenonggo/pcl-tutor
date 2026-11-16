import { makeInitials, makeStudent, makeTutor, normalizeEmail } from './auth';

// Base URL of the Django backend, resolved exactly like studyPlanApi.js:
// VITE_PCL_API_BASE wins (dev proxy or deployed host), the local Django dev
// server is the default.
const API_BASE = import.meta.env.VITE_PCL_API_BASE || 'http://localhost:8000/api';

/** Error carrying which step of the REST sign-in failed. */
export class AuthApiError extends Error {
  /** kind: 'network' | 'credentials' | 'profile' */
  constructor(kind, message) {
    super(message);
    this.name = 'AuthApiError';
    this.kind = kind;
  }
}

/**
 * Sign in through the existing backend endpoints (no new endpoints):
 *
 *   1. POST /api/login/  (SimpleJWT TokenObtainPairView) -> { access, refresh }
 *   2. GET  /api/profile/ with the access token           -> full profile + role
 *
 * The sign-in form only offers an email field, while the backend identifies
 * accounts by their Django username field, so the entered value is sent as
 * `username`. Accounts whose username is that email sign in as expected.
 *
 * Resolves to the backend profile object; throws AuthApiError on failure.
 */
export async function fetchLoginProfile(email, password) {
  const loginResponse = await fetch(`${API_BASE}/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: normalizeEmail(email), password }),
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });

  if (!loginResponse.ok) {
    throw new AuthApiError('credentials', 'The backend rejected those credentials.');
  }
  const tokens = await loginResponse.json();
  if (!tokens.access) {
    throw new AuthApiError('credentials', 'The backend returned no access token.');
  }

  const profileResponse = await fetch(`${API_BASE}/profile/`, {
    headers: { Authorization: `Bearer ${tokens.access}` },
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });
  if (!profileResponse.ok) {
    throw new AuthApiError('profile', 'The profile lookup failed after sign-in.');
  }
  const profile = await profileResponse.json();
  return { ...profile, _access: tokens.access };
}

/**
 * Map a backend profile onto the app's local account shape.
 *
 * The local factories (makeStudent/makeTutor) guarantee every field the pages
 * and selectors read (initials, rating, sessions, subjects, accent, ...); the
 * backend values are layered over them, and the backend user id is kept so a
 * later sign-in lands on the same local record.
 */
export function profileToAccount(profile) {
  const role = profile.role === 'tutor' ? 'tutor' : 'student';
  const email = normalizeEmail(profile.email);
  const name = String(profile.full_name || profile.username || '').trim() || 'PCL Tutor';

  const account = role === 'tutor'
    ? makeTutor({ name, email, password: '', subjects: profile.subjects })
    : makeStudent({ name, email, password: '', major: profile.major });

  const merged = {
    ...account,
    id: String(profile.id || account.id),
    role,
    name,
    initials: makeInitials(name) || account.initials,
    email,
    semester: Number(profile.semester) || account.semester,
    bio: profile.bio || '',
    accent: profile.accent || account.accent,
    // The SimpleJWT access token so authenticated API calls (e.g. AI key
    // validation) can use it. It expires server-side; a 401 means the user
    // signs in again and picks up a fresh token.
    token: profile._access || '',
  };

  if (role === 'tutor') {
    merged.tutorId = String(profile.id || merged.tutorId);
    merged.major = profile.major || 'Not set';
    merged.rating = Number(profile.rating) || 0;
    merged.sessions = Number(profile.sessions_count) || 0;
    merged.subjects = Array.isArray(profile.subjects) ? profile.subjects : merged.subjects;
  } else {
    merged.major = profile.major || 'Not set';
  }

  return merged;
}

/** True for a stored user object that is still usable as a session. */
export function isStoredUser(user) {
  return Boolean(
    user
    && typeof user === 'object'
    && (user.role === 'student' || user.role === 'tutor')
    && typeof (user.name || user.username) === 'string',
  );
}
