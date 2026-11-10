export const STORAGE_KEYS = {
  db: 'pcl-db-v1',
  session: 'pcl-session-v1',
  theme: 'pcl-theme-v7',
  accent: 'pcl-accent-v7',
  sidebar: 'pcl-sidebar-v7',
  legacyUser: 'pcl-user-v7',
};

export const EMPTY_DB = {
  students: [],
  tutors: [],
  sessions: [],
  requests: [],
  availability: {},
};

const hasWindow = () => typeof window !== 'undefined' && Boolean(window.localStorage);

export function readJson(key, fallback) {
  if (!hasWindow()) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function removeKey(key) {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}

export function normalizeDb(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const availability = source.availability && typeof source.availability === 'object' && !Array.isArray(source.availability)
    ? source.availability
    : {};

  return {
    students: Array.isArray(source.students) ? source.students : [],
    tutors: Array.isArray(source.tutors) ? source.tutors : [],
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    requests: Array.isArray(source.requests) ? source.requests : [],
    availability,
  };
}

export function readDb() {
  return normalizeDb(readJson(STORAGE_KEYS.db, EMPTY_DB));
}

export function writeDb(db) {
  writeJson(STORAGE_KEYS.db, normalizeDb(db));
}

export function readSession() {
  const session = readJson(STORAGE_KEYS.session, null);
  return session && typeof session.userId === 'string' && session.userId ? session : null;
}
