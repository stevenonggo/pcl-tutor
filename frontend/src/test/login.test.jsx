import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { confirmDialog, STUDENT, TUTOR, renderApp, signInAs } from './helpers';

// The sign-in flow is backed by the existing REST endpoints (POST /api/login/,
// GET /api/profile/), so the tests mock global fetch the same way
// studyPlanApi.test.js does. The default API base in tests is
// http://localhost:8000/api (VITE_PCL_API_BASE is not set).
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function studentProfile() {
  return {
    id: 'u-student-1',
    username: 'nathan',
    email: 'nathan@example.com',
    role: 'student',
    full_name: 'Nathan Andrew',
    major: 'Artificial Intelligence',
    semester: '3',
    bio: '',
    subjects: [],
    accent: '',
    rating: 0,
    sessions_count: 0,
    is_demo: false,
  };
}

function tutorProfile() {
  return {
    id: 'u-tutor-1',
    username: 'daniel',
    email: 'daniel@example.com',
    role: 'tutor',
    full_name: 'Daniel Hartono',
    major: 'Artificial Intelligence',
    semester: '7',
    bio: '',
    subjects: ['Programming Fundamentals'],
    accent: '',
    rating: 4.9,
    sessions_count: 12,
    is_demo: false,
  };
}

function mockAuthApi({ role = 'student', loginOk = true, profileOk = true, networkOk = true, registerOk = true, patchOk = true, becomeTutorStatus = 200, refetchProfile = null } = {}) {
  const profile = role === 'tutor' ? tutorProfile() : studentProfile();
  let profileGetCalls = 0;
  let patchedFields = null;
  global.fetch = vi.fn((url, init) => {
    const target = String(url);
    const method = (init && init.method) || 'GET';
    if (target.endsWith('/register/')) {
      // The register endpoint only creates the account (username/email/password).
      // registerOk=false simulates a duplicate email -> 400 with a field error,
      // which fetchRegister maps to AuthApiError('duplicate').
      if (!networkOk) return Promise.reject(new TypeError('Failed to fetch'));
      return registerOk
        ? Promise.resolve(jsonResponse(
          { message: 'User registered successfully', user: { id: 'u-new', username: 'nathan', email: 'nathan@example.com' } },
          { ok: true, status: 201 },
        ))
        : Promise.resolve(
          jsonResponse({ email: ['A user with that email already exists.'] }, { ok: false, status: 400 }),
        );
    }
    // Tutor provisioning: promote the account. 409 (already a tutor) is a
    // valid success state, so it is served without failing the flow.
    if (target.endsWith('/profile/become-tutor/')) {
      return Promise.resolve(jsonResponse(
        becomeTutorStatus === 200 ? { role: 'tutor' } : { error: 'Already a tutor.' },
        { ok: becomeTutorStatus === 200, status: becomeTutorStatus },
      ));
    }
    if (target.endsWith('/profile/')) {
      // PATCH persists full_name / major / subjects for the provisioning step.
      if (method === 'PATCH') {
        if (!networkOk) return Promise.reject(new TypeError('Failed to fetch'));
        if (patchOk) {
          patchedFields = JSON.parse(String(init.body || '{}'));
          return Promise.resolve(jsonResponse({ role: 'student' }, { ok: true, status: 200 }));
        }
        return Promise.resolve(jsonResponse({ detail: 'Profile update failed' }, { ok: false, status: 500 }));
      }
      profileGetCalls += 1;
      // The re-fetch that runs after provisioning reports what the server now
      // stores: the base profile plus the PATCHed fields, with the test's
      // promoted-profile override (if any) layered on top.
      if (profileGetCalls >= 2) {
        const refetched = { ...profile, ...(patchedFields || {}), ...(refetchProfile || {}) };
        return Promise.resolve(jsonResponse(refetched));
      }
      if (!networkOk) return Promise.reject(new TypeError('Failed to fetch'));
      return profileOk
        ? Promise.resolve(jsonResponse(profile))
        : Promise.resolve(jsonResponse({}, { ok: false, status: 500 }));
    }
    if (target.endsWith('/login/')) {
      if (!networkOk) return Promise.reject(new TypeError('Failed to fetch'));
      return loginOk
        ? Promise.resolve(jsonResponse({ access: 'access-token', refresh: 'refresh-token' }))
        : Promise.resolve(
          jsonResponse({ detail: 'No active account found with the given credentials.' }, { ok: false, status: 401 }),
        );
    }
    if (target.endsWith('/profile/')) {
      if (!networkOk) return Promise.reject(new TypeError('Failed to fetch'));
      return profileOk
        ? Promise.resolve(jsonResponse(profile))
        : Promise.resolve(jsonResponse({}, { ok: false, status: 500 }));
    }
    return Promise.reject(new Error(`Unexpected fetch in the login tests: ${target}`));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global.fetch;
});

async function fillSignIn(user, email, password) {
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('shared student / tutor sign-in', () => {
  it('offers one sign-in form with email and password only, and no role selector', async () => {
    renderApp('/login');

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    // The role switch belongs to the registration card, not to sign-in.
    expect(screen.queryByRole('button', { name: /student \/ mentee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tutor \/ mentor/i })).not.toBeInTheDocument();
  });

  it('signs a student in through the REST API and lands on the student dashboard', async () => {
    mockAuthApi({ role: 'student' });
    renderApp('/login');
    const user = userEvent.setup();

    await fillSignIn(user, 'nathan@example.com', 'secret123');

    // The session is persisted under the stored-user key with the backend profile.
    await waitFor(() => expect(localStorage.getItem('pcl-user-v7')).toContain('Nathan Andrew'));
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();

    // Both existing endpoints were called: the login and the authenticated profile.
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).toContain('http://localhost:8000/api/login/');
    expect(calls).toContain('http://localhost:8000/api/profile/');
    const [, loginInit] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/login/'));
    expect(JSON.parse(loginInit.body)).toEqual({ username: 'nathan@example.com', password: 'secret123' });
    const [, profileInit] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/profile/'));
    expect(profileInit.headers.Authorization).toBe('Bearer access-token');
  });

  it('signs a tutor in and lands on the tutor dashboard', async () => {
    mockAuthApi({ role: 'tutor' });
    renderApp('/login');
    const user = userEvent.setup();

    await fillSignIn(user, 'daniel@example.com', 'secret123');

    expect(await screen.findByText(/Make every tutoring hour count/i)).toBeInTheDocument();
    // The backend-detected tutor role is stored in the local tutor collection.
    await waitFor(() => {
      const db = JSON.parse(localStorage.getItem('pcl-db-v1'));
      expect(db.tutors.some((tutor) => tutor.name === 'Daniel Hartono')).toBe(true);
    });
  });

  it('stays on the login screen when the backend rejects the credentials', async () => {
    mockAuthApi({ loginOk: false });
    renderApp('/login');
    const user = userEvent.setup();

    await fillSignIn(user, 'nathan@example.com', 'wrong-password');

    expect(await screen.findByText(/That email or password is not correct/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('reports an unreachable backend and stays on the login screen', async () => {
    mockAuthApi({ networkOk: false });
    renderApp('/login');
    const user = userEvent.setup();

    await fillSignIn(user, 'nathan@example.com', 'secret123');

    expect(await screen.findByText(/Could not reach the PCL Tutor server/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('signs out and clears the stored session', async () => {
    signInAs(STUDENT);
    renderApp('/');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    await confirmDialog(user, 'Log out');

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(localStorage.getItem('pcl-user-v7')).toBeNull();
    expect(localStorage.getItem('pcl-session-v1')).toBeNull();
  });
});

describe('session restore and dashboard separation', () => {
  it('redirects to the dashboard when a session is already stored', async () => {
    signInAs(STUDENT);
    renderApp('/login');
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();
  });

  it('keeps the tutor and student dashboards distinct', async () => {
    signInAs(TUTOR);
    const { unmount } = renderApp('/');
    expect(await screen.findByText(/Make every tutoring hour count/i)).toBeInTheDocument();
    unmount();

    signInAs(STUDENT);
    renderApp('/');
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();
  });
});

describe('registration (unchanged role selection and role-specific fields)', () => {
  it('shows the major field for students and the subject picker for tutors', async () => {
    renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign Up' }));

    // Student registration keeps its role-specific major field.
    expect(screen.getByLabelText(/major/i)).toBeInTheDocument();
    expect(screen.queryByText(/Subjects you teach/i)).not.toBeInTheDocument();

    // Tutors pick their role in the registration card and get the subject picker.
    await user.click(await screen.findByRole('button', { name: /tutor \/ mentor/i }));
    expect(screen.getByText(/Subjects you teach/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/major/i)).not.toBeInTheDocument();
  });
});

describe('backend registration (register -> login/profile -> saved account)', () => {
  it('signs up through the backend and lands on the dashboard with a JWT', async () => {
    mockAuthApi({ role: 'student' });
    renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await user.type(screen.getByLabelText(/full name/i), 'Nadia Newcomer');
    await user.type(screen.getByLabelText(/major/i), 'Artificial Intelligence');
    await user.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // Sign-in happens after account creation, so the student dashboard is reached.
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();

    // The register call uses username = email; then the same login + profile pair.
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).toContain('http://localhost:8000/api/register/');
    expect(calls).toContain('http://localhost:8000/api/login/');
    expect(calls).toContain('http://localhost:8000/api/profile/');
    const [, registerInit] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/register/'));
    expect(JSON.parse(registerInit.body)).toEqual({ username: 'nadia@example.com', email: 'nadia@example.com', password: 'secret1234' });

    // The stored account carries the JWT from the login/profile sign-in step.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('pcl-user-v7')).token).toBe('access-token'));
  });

  it('stores the entered name for student signups, not the email address', async () => {
    mockAuthApi({
      refetchProfile: { ...studentProfile(), id: 'u-new', username: 'nadia', email: 'nadia@example.com', full_name: 'Nadia Newcomer' },
    });
    renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await user.type(screen.getByLabelText(/full name/i), 'Nadia Newcomer');
    await user.type(screen.getByLabelText(/major/i), 'Artificial Intelligence');
    await user.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();

    // Student signups now also PATCH their profile details to the backend.
    const patchCall = global.fetch.mock.calls.find(([url, init]) => String(url).endsWith('/profile/') && init && init.method === 'PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual({ full_name: 'Nadia Newcomer', major: 'Artificial Intelligence' });
    // The tutor-only promotion is never attempted for students.
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).not.toContain('http://localhost:8000/api/profile/become-tutor/');

    // The stored account shows the entered name — not the email address.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('pcl-user-v7'));
      expect(stored.name).toBe('Nadia Newcomer');
      expect(stored.name).not.toBe(stored.email);
    });
  });

  it('surfaces the duplicate-email error without attempting sign-in', async () => {
    mockAuthApi({ role: 'student', registerOk: false });
    renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await user.type(screen.getByLabelText(/full name/i), 'Nathan Andrew');
    await user.type(screen.getByLabelText(/major/i), 'Artificial Intelligence');
    await user.type(screen.getByLabelText(/email/i), 'nathan@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/An account with that email already exists/i)).toBeInTheDocument();
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).toContain('http://localhost:8000/api/register/');
    expect(calls).not.toContain('http://localhost:8000/api/login/');
  });

  it('rejects a password under 8 characters before any network call', async () => {
    mockAuthApi({ role: 'student' });
    renderApp('/login');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await user.type(screen.getByLabelText(/full name/i), 'Nadia Newcomer');
    await user.type(screen.getByLabelText(/major/i), 'Artificial Intelligence');
    await user.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'short1');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  async function fillTutorRegister(user, { name, email, password, subject }) {
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await user.click(await screen.findByRole('button', { name: /tutor \/ mentor/i }));
    await user.type(screen.getByRole('combobox'), subject);
    await user.click(await screen.findByRole('option', { name: subject }));
    await user.type(screen.getByLabelText(/full name/i), name);
    await user.type(screen.getByLabelText(/email/i), email);
    await user.type(screen.getByLabelText('Password'), password);
  }

  const promotedTina = () => ({
    ...tutorProfile(),
    id: 'u-new',
    username: 'tina',
    email: 'tina@example.com',
    full_name: 'Tina Tutor',
    subjects: ['Programming Fundamentals'],
    rating: 0,
    sessions_count: 0,
  });

  it('completes tutor signup: persists subjects, promotes the role, stores the tutor', async () => {
    mockAuthApi({ refetchProfile: promotedTina() });
    renderApp('/login');
    const user = userEvent.setup();

    await fillTutorRegister(user, { name: 'Tina Tutor', email: 'tina@example.com', password: 'secret1234', subject: 'Programming Fundamentals' });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // Promotion succeeded, so the tutor dashboard is reached.
    expect(await screen.findByText(/Make every tutoring hour count/i)).toBeInTheDocument();

    // The provisioning sequence ran after the sign-in pair.
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).toContain('http://localhost:8000/api/register/');
    expect(calls).toContain('http://localhost:8000/api/profile/become-tutor/');

    // The PATCH carried the form's profile details and the chosen subjects.
    const patchCall = global.fetch.mock.calls.find(([url, init]) => String(url).endsWith('/profile/') && init && init.method === 'PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual({ full_name: 'Tina Tutor', subjects: ['Programming Fundamentals'] });

    // The stored account is the promoted tutor, holding the chosen subjects.
    await waitFor(() => {
      const db = JSON.parse(localStorage.getItem('pcl-db-v1'));
      const record = [...db.students, ...db.tutors].find((item) => item.email === 'tina@example.com');
      expect(record.role).toBe('tutor');
      expect(db.tutors).toContain(record);
      expect(record.subjects).toEqual(['Programming Fundamentals']);
    });
  });

  it('treats a 409 from become-tutor (already a tutor) as success', async () => {
    mockAuthApi({ becomeTutorStatus: 409, refetchProfile: promotedTina() });
    renderApp('/login');
    const user = userEvent.setup();

    await fillTutorRegister(user, { name: 'Tina Tutor', email: 'tina@example.com', password: 'secret1234', subject: 'Programming Fundamentals' });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // 409 is not an error: the signup still completes as a tutor.
    expect(await screen.findByText(/Make every tutoring hour count/i)).toBeInTheDocument();
    await waitFor(() => {
      const db = JSON.parse(localStorage.getItem('pcl-db-v1'));
      const record = db.tutors.find((item) => item.email === 'tina@example.com');
      expect(record).toBeTruthy();
      expect(record.subjects).toEqual(['Programming Fundamentals']);
    });
  });

  it('keeps the registered session when provisioning fails, and flags it', async () => {
    mockAuthApi({ patchOk: false });
    renderApp('/login');
    const user = userEvent.setup();

    await fillTutorRegister(user, { name: 'Tina Tutor', email: 'tina@example.com', password: 'secret1234', subject: 'Programming Fundamentals' });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // The account was created and the user is signed in as a student (the
    // pre-promotion profile) — the registered session is not lost.
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('pcl-user-v7'));
      expect(stored.token).toBe('access-token');
      expect(stored.role).toBe('student');
    });

    // The incomplete setup surfaces as a dismissible banner, not a hard failure.
    expect(await screen.findByText(/profile setup could not be completed/i)).toBeInTheDocument();
    // Promotion was never attempted: the PATCH failed first.
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls).not.toContain('http://localhost:8000/api/profile/become-tutor/');
  });
});
