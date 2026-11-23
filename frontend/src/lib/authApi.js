import { makeInitials, makeStudent, makeTutor, normalizeEmail } from './auth';

// Base URL of the Django backend, resolved exactly like studyPlanApi.js:
// VITE_PCL_API_BASE wins (dev proxy or deployed host), the local Django dev
// server is the default.
const API_BASE = import.meta.env.VITE_PCL_API_BASE || 'http://localhost:8000/api';

/** Error carrying which step of the REST auth flow failed. */
export class AuthApiError extends Error {
  /** kind: 'network' | 'credentials' | 'profile' | 'register' | 'duplicate' */
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
 * Create the account on the existing backend endpoint:
 *
 *   POST /api/register/  ->  201 { message, user: { id, username, email } }
 *
 * The endpoint only accepts username, email and password; created users start
 * as students. The caller then signs in through the same /login/ + /profile/
 * pair used by the sign-in form (fetchLoginProfile), which is what carries the
 * JWT. The entered email doubles as the username so the follow-up sign-in —
 * which authenticates by username — works exactly like a normal sign-in.
 */
export async function fetchRegister(email, password) {
  const cleanEmail = normalizeEmail(email);
  const response = await fetch(`${API_BASE}/register/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cleanEmail, email: cleanEmail, password }),
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });

  if (!response.ok) {
    // A 400 carries the DRF serializer errors; a duplicate email surfaces in
    // the `email` (or `username`) field.
    const body = await response.json().catch(() => ({}));
    if (response.status === 400 && (Array.isArray(body.email) || Array.isArray(body.username))) {
      throw new AuthApiError('duplicate', 'An account with that email already exists.');
    }
    throw new AuthApiError('register', 'Account creation was rejected. Please try again.');
  }
}

/**
 * Re-read the signed-in user's backend profile with a SimpleJWT access token.
 * Used after provisioning (PATCH profile / become-tutor) so the local account
 * reflects the backend's current role and subjects.
 */
export async function fetchProfile(accessToken) {
  const response = await fetch(`${API_BASE}/profile/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });
  if (!response.ok) {
    throw new AuthApiError('profile', 'The profile lookup failed after sign-in.');
  }
  return response.json();
}

/**
 * Persist editable profile fields on the backend:
 *
 *   PATCH /api/profile/  (authenticated)
 *
 * Accepts any of { full_name, major, semester, bio, accent } as strings and
 * `subjects` as a list of strings (trims, caps at 20 server-side). The
 * backend does not validate subjects against the catalog — the caller sends
 * catalog names from the subject picker.
 */
export async function fetchPatchProfile(accessToken, fields) {
  const response = await fetch(`${API_BASE}/profile/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(fields),
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });
  if (!response.ok) {
    throw new AuthApiError('provision', 'Profile details could not be saved. The account was created — finish it in your profile later.');
  }
}

/**
 * Promote a student account to tutor:
 *
 *   POST /api/profile/become-tutor/  (authenticated, no payload)
 *
 * 200 promotes; 409 means the account is already a tutor, which counts as
 * success so retries stay idempotent.
 */
export async function fetchBecomeTutor(accessToken) {
  const response = await fetch(`${API_BASE}/profile/become-tutor/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  }).catch(() => {
    throw new AuthApiError('network', 'The PCL Tutor backend could not be reached.');
  });
  if (response.status !== 200 && response.status !== 409) {
    throw new AuthApiError('provision', 'Tutor setup could not be completed. The account was created — sign in and finish it in your profile later.');
  }
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
