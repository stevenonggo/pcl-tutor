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

function mockAuthApi({ role = 'student', loginOk = true, profileOk = true, networkOk = true } = {}) {
  const profile = role === 'tutor' ? tutorProfile() : studentProfile();
  global.fetch = vi.fn((url) => {
    const target = String(url);
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
