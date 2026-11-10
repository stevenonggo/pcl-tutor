import { ACCENTS } from '../data/catalog';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function makeInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function makeId(prefix) {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function accentFor(seed) {
  const text = String(seed || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length];
}

export function validateRegistration({ role, name, email, password, major, subjects }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');
  const cleanMajor = String(major || '').trim();
  const cleanSubjects = Array.isArray(subjects) ? subjects : [];

  if (role !== 'student' && role !== 'tutor') return 'Choose whether you are registering as a student or a tutor.';
  if (cleanName.length < 2) return 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return 'Enter a valid email address.';
  if (cleanPassword.length < 6) return 'Use a password with at least 6 characters.';
  // A student's major is required; a tutor's is optional, so the check is scoped to students.
  if (role === 'student' && cleanMajor.length < 2) return 'Enter your major.';
  // A tutor must teach at least one subject from the catalog.
  if (role === 'tutor' && cleanSubjects.length < 1) return 'Select at least one subject you teach.';
  return null;
}

export function makeStudent({ name, email, password, major }) {
  const cleanName = String(name || '').trim();
  const cleanMajor = String(major || '').trim();
  return {
    id: makeId('u'),
    role: 'student',
    name: cleanName,
    initials: makeInitials(cleanName),
    email: normalizeEmail(email),
    password: String(password || ''),
    // Fall back to 'Not set' so accounts saved before the major field was required stay valid.
    major: cleanMajor || 'Not set',
    semester: 1,
    bio: '',
    createdAt: Date.now(),
  };
}

export function makeTutor({ name, email, password, subjects }) {
  const cleanName = String(name || '').trim();
  const id = makeId('t');
  const cleanSubjects = Array.isArray(subjects) ? subjects : [];
  return {
    id,
    tutorId: id,
    role: 'tutor',
    name: cleanName,
    initials: makeInitials(cleanName),
    email: normalizeEmail(email),
    password: String(password || ''),
    major: 'Not set',
    semester: 1,
    rating: 0,
    sessions: 0,
    participantsToday: 0,
    // Selected at registration from the subject catalog; an empty array is the
    // fallback so tutor accounts created before this field stay valid.
    subjects: cleanSubjects,
    modes: [],
    about: '',
    accent: accentFor(normalizeEmail(email) || cleanName),
    createdAt: Date.now(),
  };
}

export function findAccount(db, { email, role }) {
  const accounts = role === 'tutor' ? db.tutors : db.students;
  const cleanEmail = normalizeEmail(email);
  return (accounts || []).find((item) => normalizeEmail(item.email) === cleanEmail) || null;
}

export function accountExists(db, email) {
  const cleanEmail = normalizeEmail(email);
  return [...(db.students || []), ...(db.tutors || [])]
    .some((item) => normalizeEmail(item.email) === cleanEmail);
}
