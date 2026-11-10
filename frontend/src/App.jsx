import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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
import SettingsDrawer from './components/SettingsDrawer';
import { accountExists, findAccount, makeStudent, makeTutor, validateRegistration } from './lib/auth';
import { buildNotifications, tutorsWithModes, visibleRequestsFor } from './lib/selectors';
import { readDb, readJson, readSession, removeKey, STORAGE_KEYS, writeDb, writeJson } from './lib/storage';
import { slotKey } from './lib/slots';

function ProtectedRoutes({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  // One versioned database is the single source of truth for accounts and workspace data.
  const [db, setDb] = useState(readDb);
  const [session, setSession] = useState(readSession);
  const [theme, setTheme] = useState(() => readJson(STORAGE_KEYS.theme, 'light'));
  const [accent, setAccent] = useState(() => readJson(STORAGE_KEYS.accent, '#0B8F68'));
  const [collapsed, setCollapsed] = useState(() => readJson(STORAGE_KEYS.sidebar, false));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const user = useMemo(() => {
    if (!session?.userId) return null;
    return [...db.students, ...db.tutors].find((item) => item.id === session.userId) || null;
  }, [db.students, db.tutors, session]);

  const tutors = useMemo(() => tutorsWithModes(db.tutors, db.availability), [db.tutors, db.availability]);
  const visibleRequests = useMemo(() => visibleRequestsFor(user, db.requests), [user, db.requests]);
  const notifications = useMemo(
    () => buildNotifications(user, db.sessions, db.requests),
    [user, db.sessions, db.requests],
  );

  useEffect(() => {
    writeDb(db);
  }, [db]);

  useEffect(() => {
    if (session?.userId) writeJson(STORAGE_KEYS.session, session);
    else removeKey(STORAGE_KEYS.session);
  }, [session]);

  useEffect(() => {
    removeKey(STORAGE_KEYS.legacyUser);
  }, []);

  useEffect(() => {
    if (session?.userId && !user) setSession(null);
  }, [session, user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeJson(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    writeJson(STORAGE_KEYS.accent, accent);
  }, [accent]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.sidebar, collapsed);
  }, [collapsed]);

  // Login reads only accounts that actually exist in the local database.
  const login = ({ email, password, role }) => {
    const account = findAccount(db, { email, role });
    if (!account || account.password !== password) {
      return { ok: false, error: 'That email or password is not correct.' };
    }
    setSession({ userId: account.id });
    return { ok: true, user: account };
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
    setSession({ userId: account.id });
    return { ok: true, user: account };
  };

  const logout = () => setSession(null);

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
      <Route
        path="*"
        element={(
          <ProtectedRoutes user={user}>
            <AppShell
              user={user}
              notifications={notifications}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              onOpenSettings={() => setSettingsOpen(true)}
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
              <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
            </AppShell>
          </ProtectedRoutes>
        )}
      />
    </Routes>
  );
}
