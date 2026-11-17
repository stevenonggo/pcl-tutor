import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FindTutorPage from './pages/FindTutorPage';
import SessionsPage from './pages/SessionsPage';
import ActivityPage from './pages/ActivityPage';
import RequestsPage from './pages/RequestsPage';
import AvailabilityPage from './pages/AvailabilityPage';
import SubjectsPage from './pages/SubjectsPage';
import StudyPlanPage from './pages/StudyPlanPage';
import ProfilePage from './pages/ProfilePage';
import TutorDetailPage from './pages/TutorDetailPage';
import FormPage from './pages/FormPage';
import NotFoundPage from './pages/NotFoundPage';
import AppShell from './components/AppShell';
import SettingsPage from './pages/SettingsPage';
import { accountExists, makeInitials, makeStudent, makeTutor, normalizeEmail, validateRegistration } from './lib/auth';
import { AuthApiError, fetchLoginProfile, isStoredUser, profileToAccount } from './lib/authApi';
import { buildNotifications, tutorsWithModes, visibleRequestsFor } from './lib/selectors';
import { readDb, readJson, readSession, removeKey, STORAGE_KEYS, writeDb, writeJson } from './lib/storage';
import { slotKey } from './lib/slots';

function ProtectedRoutes({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Human-readable sign-in failures, keyed by the AuthApiError kind.
const LOGIN_ERROR_MESSAGES = {
  credentials: 'That email or password is not correct.',
  network: 'Could not reach the PCL Tutor server. Check that the backend is running, then try again.',
  profile: 'Signed in, but the profile service is unavailable. Please sign in again.',
};

/**
 * Restore the signed-in user from storage. The stored user object
 * (pcl-user-v7) takes priority; the older session record (pcl-session-v1) is
 * migrated by looking the account up in the local database.
 */
function restoreStoredUser() {
  const stored = readJson(STORAGE_KEYS.legacyUser, null);
  if (isStoredUser(stored)) return stored;
  const legacy = readSession();
  if (legacy?.userId) {
    const db = readDb();
    const found = [...db.students, ...db.tutors].find((item) => item.id === legacy.userId);
    if (found) return found;
  }
  return null;
}

/**
 * Give a restored user record the full local account shape: missing ids come
 * from the account factories, and existing local identifiers (tutorId, ...)
 * are preserved so seeded requests and availability keep matching.
 */
function normalizeUserRecord(stored) {
  const base = stored.role === 'tutor'
    ? makeTutor({ name: stored.name || stored.username, email: stored.email, password: '', subjects: stored.subjects })
    : makeStudent({ name: stored.name || stored.username, email: stored.email, password: '', major: stored.major });
  return {
    ...base,
    ...stored,
    id: stored.id || base.id,
    tutorId: stored.tutorId || (stored.role === 'tutor' ? stored.id || base.tutorId : base.tutorId),
    role: stored.role,
  };
}

/**
 * Upsert an account into the local database, matched by id or (case-insensitive)
 * email. The backend-detected role is the source of truth: a role change moves
 * the record between the students and tutors collections.
 */
function upsertAccount(db, account) {
  const matched = [...db.students, ...db.tutors].find((item) => (
    item.id === account.id || normalizeEmail(item.email) === normalizeEmail(account.email)
  ));
  const collectionKey = account.role === 'tutor' ? 'tutors' : 'students';
  const otherKey = account.role === 'tutor' ? 'students' : 'tutors';
  const isMatch = (item) => item.id === matched?.id || normalizeEmail(item.email) === normalizeEmail(account.email);
  return {
    ...db,
    [otherKey]: db[otherKey].filter((item) => !isMatch(item)),
    [collectionKey]: [
      ...db[collectionKey].filter((item) => !isMatch(item)),
      { ...(matched || {}), ...account },
    ],
  };
}

export default function App() {
  // One versioned database is the single source of truth for accounts and workspace data.
  const [db, setDb] = useState(readDb);
  const navigate = useNavigate();
  // The signed-in user, restored from storage on load (see restoreStoredUser).
  const [user, setUser] = useState(restoreStoredUser);
  const [theme, setTheme] = useState(() => readJson(STORAGE_KEYS.theme, 'light'));
  const [collapsed, setCollapsed] = useState(() => readJson(STORAGE_KEYS.sidebar, false));

  const tutors = useMemo(() => tutorsWithModes(db.tutors, db.availability), [db.tutors, db.availability]);
  const visibleRequests = useMemo(() => visibleRequestsFor(user, db.requests), [user, db.requests]);
  const notifications = useMemo(
    () => buildNotifications(user, db.sessions, db.requests),
    [user, db.sessions, db.requests],
  );

  useEffect(() => {
    writeDb(db);
  }, [db]);

  // Persist the signed-in user on both session keys so a reload restores the
  // session; signing out clears both.
  useEffect(() => {
    if (user) {
      writeJson(STORAGE_KEYS.legacyUser, user);
      writeJson(STORAGE_KEYS.session, { userId: user.id });
    } else {
      removeKey(STORAGE_KEYS.legacyUser);
      removeKey(STORAGE_KEYS.session);
    }
  }, [user]);

  // A restored user may not have a local record yet (fresh database): make
  // sure one exists so the pages and selectors that read the database work.
  useEffect(() => {
    if (!user) return;
    const record = normalizeUserRecord(user);
    setDb((current) => upsertAccount(current, record));
    if (record.id !== user.id) setUser(record);
    // Mount-time migration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeJson(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.sidebar, collapsed);
  }, [collapsed]);

  // Sign-in for both roles goes through the existing REST endpoints; the
  // backend profile is the source of truth for the account's real role.
  const login = async ({ email, password }) => {
    try {
      const account = profileToAccount(await fetchLoginProfile(email, password));
      setDb((current) => upsertAccount(current, account));
      setUser(account);
      return { ok: true, user: account };
    } catch (error) {
      const message = error instanceof AuthApiError
        ? LOGIN_ERROR_MESSAGES[error.kind]
        : 'Sign-in failed. Please try again.';
      return { ok: false, error: message };
    }
  };

  const register = ({ role, name, email, password, major, subjects }) => {
    const error = validateRegistration({ role, name, email, password, major, subjects });
    if (error) return { ok: false, error };
    if (accountExists(db, email)) {
      return { ok: false, error: 'An account with that email already exists.' };
    }

    const account = role === 'tutor'
      ? makeTutor({ name, email, password, subjects })
      : makeStudent({ name, email, password, major });

    setDb((current) => {
      if (role === 'tutor') {
        return {
          ...current,
          tutors: [...current.tutors, account],
          availability: { ...current.availability, [account.id]: {} },
        };
      }
      return { ...current, students: [...current.students, account] };
    });
    setUser(account);
    return { ok: true, user: account };
  };

  const logout = () => setUser(null);

  const updateUser = (patch) => {
    if (!user) return;
    const next = { ...user, ...patch };
    const renamed = Boolean(patch.name && patch.name !== user.name);

    setDb((current) => {
      const collectionKey = user.role === 'student' ? 'students' : 'tutors';
      const collection = current[collectionKey].map((item) => (
        item.id === user.id ? { ...item, ...patch } : item
      ));
      let sessions = current.sessions;
      let requests = current.requests;

      if (renamed && user.role === 'student') {
        sessions = sessions.map((sessionItem) => (
          sessionItem.studentId === user.id || (!sessionItem.studentId && sessionItem.studentName === user.name)
            ? { ...sessionItem, studentName: patch.name }
            : sessionItem
        ));
        requests = requests.map((request) => (
          request.studentId === user.id || (!request.studentId && request.studentName === user.name)
            ? { ...request, studentName: patch.name, studentInitials: next.initials }
            : request
        ));
      }

      if (renamed && user.role === 'tutor') {
        sessions = sessions.map((sessionItem) => (
          sessionItem.tutorId === user.tutorId || sessionItem.tutorId === user.id
            ? { ...sessionItem, tutorName: patch.name }
            : sessionItem
        ));
        requests = requests.map((request) => (
          request.tutorId === user.tutorId || request.tutorId === user.id
            ? { ...request, tutorName: patch.name }
            : request
        ));
      }

      return { ...current, [collectionKey]: collection, sessions, requests };
    });

    // The user object is app state now, so profile edits must land in both
    // the database record and the in-memory user (initials follow renames).
    setUser((current) => (
      current
        ? { ...current, ...patch, initials: patch.name ? makeInitials(patch.name) : current.initials }
        : current
    ));
  };

  // Booking creates both sides of the same request so Student and Tutor views stay in sync.
  const createSession = (payload) => {
    if (!user) return null;
    const stamp = Date.now();
    const sessionId = `s${stamp}`;
    const requestId = `r${stamp}`;
    const request = {
      id: requestId,
      sessionId,
      tutorId: payload.tutorId,
      tutorName: payload.tutorName,
      studentId: user.id,
      studentName: user.name,
      studentInitials: user.initials,
      subject: payload.subject,
      topic: payload.topic,
      date: payload.date,
      time: payload.time,
      mode: payload.mode,
      location: payload.location || '',
      status: 'Pending',
      custom: payload.custom,
      message: payload.notes || 'Student requested support.',
    };
    const sessionRecord = {
      ...payload,
      id: sessionId,
      studentId: user.id,
      studentName: user.name,
      status: 'Pending',
    };
    setDb((current) => ({
      ...current,
      sessions: [sessionRecord, ...current.sessions],
      requests: [request, ...current.requests],
    }));
    return request;
  };

  // Tutor decisions update the request and its matching session together.
  const requestAction = (id, action, details = {}) => {
    setDb((current) => {
      const matched = current.requests.find((item) => item.id === id);
      if (!matched) return current;

      const nextRequestStatus = action === 'confirmed' ? 'Confirmed' : action === 'rejected' ? 'Rejected' : 'Suggested';
      const nextSessionStatus = action === 'confirmed' ? 'Confirmed' : action === 'rejected' ? 'Cancelled' : 'Pending';

      const schedule = {};
      ['date', 'time', 'alternative'].forEach((field) => {
        if (details[field] !== undefined) schedule[field] = details[field];
      });
      const suggestion = details.suggestion ? { suggestion: details.suggestion } : {};

      return {
        ...current,
        requests: current.requests.map((item) => (
          item.id === id ? { ...item, status: nextRequestStatus, ...schedule, ...suggestion } : item
        )),
        sessions: current.sessions.map((sessionItem) => (
          sessionItem.id === matched.sessionId
            ? { ...sessionItem, status: nextSessionStatus, ...schedule }
            : sessionItem
        )),
      };
    });
  };

  // Slots are stored as objects so a published in-person hour keeps its mode and
  // meeting place all the way to the booking form.
  const addAvailability = (tutorId, date, slot) => {
    setDb((current) => {
      const existing = current.availability?.[tutorId]?.[date] || [];
      if (existing.some((item) => slotKey(item) === slotKey(slot))) return current;
      return {
        ...current,
        availability: {
          ...current.availability,
          [tutorId]: {
            ...(current.availability?.[tutorId] || {}),
            [date]: [...existing, slot].sort((a, b) => a.time.localeCompare(b.time)),
          },
        },
      };
    });
  };

  const removeAvailability = (tutorId, date, key) => {
    setDb((current) => ({
      ...current,
      availability: {
        ...current.availability,
        [tutorId]: {
          ...(current.availability?.[tutorId] || {}),
          [date]: (current.availability?.[tutorId]?.[date] || []).filter((item) => slotKey(item) !== key),
        },
      },
    }));
  };

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={login} onRegister={register} />} />
      {/* The settings page is standalone (no main-app chrome around it) but still requires sign-in. */}
      <Route path="/settings" element={user ? <SettingsPage theme={theme} setTheme={setTheme} /> : <Navigate to="/login" replace />} />
      <Route
        path="*"
        element={(
          <ProtectedRoutes user={user}>
            <AppShell
              user={user}
              notifications={notifications}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              onOpenSettings={() => navigate('/settings')}
              onLogout={logout}
            >
              <Routes>
                <Route path="/" element={<DashboardPage user={user} sessions={db.sessions} requests={visibleRequests} tutors={tutors} availability={db.availability} />} />
                <Route path="/find" element={<FindTutorPage tutors={tutors} />} />
                <Route path="/sessions" element={<SessionsPage user={user} sessions={db.sessions} requests={visibleRequests} availability={db.availability} />} />
                <Route path="/activity" element={<ActivityPage user={user} notifications={notifications} />} />
                <Route path="/notifications" element={<ActivityPage user={user} notifications={notifications} notificationsOnly />} />
                <Route path="/requests" element={<RequestsPage user={user} requests={visibleRequests} onRequestAction={requestAction} />} />
                <Route path="/availability" element={<AvailabilityPage user={user} tutors={tutors} availability={db.availability} onAddAvailability={addAvailability} onRemoveAvailability={removeAvailability} />} />
                <Route path="/subjects" element={<SubjectsPage user={user} tutors={tutors} onUpdateTutor={updateUser} />} />
                <Route path="/study-plan" element={<StudyPlanPage tutors={tutors} />} />
                <Route path="/profile" element={<ProfilePage user={user} onSave={updateUser} />} />
                <Route path="/tutor/:id" element={<TutorDetailPage user={user} tutors={tutors} availability={db.availability} />} />
                <Route path="/booking" element={<FormPage user={user} requests={visibleRequests} tutors={tutors} availability={db.availability} onCreateSession={createSession} onAddAvailability={addAvailability} onRequestAction={requestAction} />} />
                <Route path="/form" element={<Navigate to="/booking" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </AppShell>
          </ProtectedRoutes>
        )}
      />
    </Routes>
  );
}
