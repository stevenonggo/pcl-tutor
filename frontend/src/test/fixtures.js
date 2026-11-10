import { CAMPUS_SPOTS, buildAvailability, ensureBothModes, makeRng, modesFor, seedAvailability } from '../lib/slots';

export const DEMO_STUDENT = {
  id: 'u1',
  role: 'student',
  name: 'Nathan Andrew',
  initials: 'NA',
  email: 'student@pcl.test',
  password: 'student123',
  major: 'Artificial Intelligence',
  semester: 3,
  bio: '',
};

export const SCHEDULE_SEED = 20261001;

const MAJOR = 'Artificial Intelligence';

const TUTOR_PROFILES = [
  {
    id: 't1',
    name: 'Daniel Hartono',
    initials: 'DH',
    semester: 7,
    rating: 4.9,
    sessions: 86,
    participantsToday: 4,
    modes: ['Online', 'Offline'],
    subjects: ['Programming Fundamentals', 'C', 'Advanced C++'],
    about: 'I like turning intimidating programming problems into a sequence of small, testable steps.',
    accent: '#0B8F68',
    dates: ['2026-09-28', '2026-09-29', '2026-10-01'],
    slotsPerDay: [2, 2, 2],
    offlineRatio: 0.5,
  },
  {
    id: 't2',
    name: 'Hendra Tjahyadi',
    initials: 'HT',
    semester: 8,
    rating: 4.8,
    sessions: 112,
    participantsToday: 6,
    modes: ['Online', 'Offline'],
    subjects: ['Linear Algebra', 'Calculus', 'Probability & Statistics'],
    about: 'Concept-first math tutoring with lots of visual intuition before formulas.',
    accent: '#3568C8',
    dates: ['2026-09-28', '2026-09-30', '2026-10-02'],
    slotsPerDay: [2, 2, 2],
    offlineRatio: 0.6,
  },
  {
    id: 't3',
    name: 'Graciella Tan',
    initials: 'GT',
    semester: 5,
    rating: 4.9,
    sessions: 71,
    participantsToday: 3,
    modes: ['Online', 'Offline'],
    subjects: ['Human Computer Interaction', 'Web Development'],
    about: 'I focus on making interfaces easier to reason about, from wireframe to CSS implementation.',
    accent: '#7A5AF8',
    dates: ['2026-09-29', '2026-10-01'],
    slotsPerDay: [2, 2],
    offlineRatio: 0.34,
  },
  {
    id: 't4',
    name: 'Richie Sutedja',
    initials: 'RS',
    semester: 7,
    rating: 4.7,
    sessions: 59,
    participantsToday: 2,
    modes: ['Online'],
    subjects: ['Deep Learning', 'Visual Perception'],
    about: 'I teach the intuition behind model architecture, loss functions, and computer vision pipelines.',
    accent: '#D97706',
    dates: ['2026-09-30', '2026-10-02'],
    slotsPerDay: [2, 2],
    offlineRatio: 0,
  },
  {
    id: 't5',
    name: 'Yudhistira Wijaya',
    initials: 'YW',
    semester: 8,
    rating: 4.8,
    sessions: 95,
    participantsToday: 5,
    modes: ['Online', 'Offline'],
    subjects: ['Algorithm and Data Structure', 'Discrete Math'],
    about: 'Practice-heavy sessions for algorithms, proofs, and problem decomposition.',
    accent: '#475569',
    dates: ['2026-09-28', '2026-10-01', '2026-10-03'],
    slotsPerDay: [1, 2, 2],
    offlineRatio: 0.7,
  },
  {
    id: 't6',
    name: 'Calvin Lim',
    initials: 'CL',
    semester: 6,
    rating: 4.6,
    sessions: 44,
    participantsToday: 1,
    modes: ['Online', 'Offline'],
    subjects: ['Data Communication and Network System', 'Computer Architecture Organization and Operating System'],
    about: 'I explain systems topics with packet traces, diagrams, and practical debugging examples.',
    accent: '#0F766E',
    dates: ['2026-09-29', '2026-10-02'],
    slotsPerDay: [2, 2],
    offlineRatio: 0.45,
  },
];

const rng = makeRng(SCHEDULE_SEED);

export const TUTORS = TUTOR_PROFILES.map((profile) => {
  const { dates, slotsPerDay, offlineRatio, modes, ...rest } = profile;
  const availability = ensureBothModes(
    buildAvailability({ rng, dates, offlineRatio, slotsPerDay, spots: CAMPUS_SPOTS }),
    modes,
  );
  return {
    ...rest,
    role: 'tutor',
    tutorId: profile.id,
    email: `${profile.id}@pcl.test`,
    password: 'tutor123',
    major: MAJOR,
    modes: modesFor(availability),
    availability,
  };
});

export const DEMO_ACCOUNTS = [DEMO_STUDENT, TUTORS[0]];

export const DEMO_AVAILABILITY = seedAvailability(TUTORS);

export function getTutor(tutorId) {
  return TUTORS.find((tutor) => tutor.id === tutorId) || TUTORS[0];
}

function pickSlots(tutorId, count, taken = []) {
  const tutor = getTutor(tutorId);
  const used = new Set(taken);
  const picked = [];
  Object.keys(tutor.availability).sort().forEach((date) => {
    tutor.availability[date].forEach((slot) => {
      const key = `${date}|${slot.time}`;
      if (picked.length < count && !used.has(key)) {
        used.add(key);
        picked.push({ date, slot, tutor, key });
      }
    });
  });
  return picked;
}

const t1Slots = pickSlots('t1', 12);

function tutorHas(slots, date, time) {
  return slots.some((item) => item.date === date && item.slot.time === time);
}

const onlineSlot = t1Slots.find((item) => item.slot.mode === 'Online');
const offlineSlot = t1Slots.find((item) => item.slot.mode === 'Offline');
const claimed = new Set([onlineSlot.key, offlineSlot.key]);
const otherSlot = t1Slots.find((item) => !claimed.has(item.key));
const hendraSlot = pickSlots('t2', 1)[0];

const customDate = otherSlot.date;
const customTime = ['08:00', '12:00', '17:30', '19:00'].find(
  (time) => !tutorHas(t1Slots, customDate, time),
);

export const INITIAL_SESSIONS = [
  {
    id: 's1',
    tutorId: 't2',
    tutorName: 'Hendra Tjahyadi',
    studentId: 'u1',
    studentName: 'Nathan Andrew',
    subject: 'Linear Algebra',
    topic: 'Eigenvectors and matrix transformations',
    date: hendraSlot.date,
    time: hendraSlot.slot.time,
    mode: hendraSlot.slot.mode,
    location: hendraSlot.slot.location,
    status: 'Confirmed',
    notes: 'Need help connecting the geometric intuition to the formulas.',
  },
  {
    id: 's2',
    tutorId: 't1',
    tutorName: 'Daniel Hartono',
    studentId: 'u2',
    studentName: 'Mikaela Putri',
    subject: 'Advanced C++',
    topic: 'Pointers and memory ownership',
    date: onlineSlot.date,
    time: onlineSlot.slot.time,
    mode: onlineSlot.slot.mode,
    location: onlineSlot.slot.location,
    status: 'Pending',
    notes: 'I understand the syntax but still get lost when debugging ownership issues.',
  },
  {
    id: 's3',
    tutorId: 't1',
    tutorName: 'Daniel Hartono',
    studentId: 'u3',
    studentName: 'Jason Tan',
    subject: 'Programming Fundamentals',
    topic: 'Recursion and base cases',
    date: customDate,
    time: customTime,
    mode: 'Offline',
    location: CAMPUS_SPOTS[0],
    status: 'Pending',
    notes: 'Could we use the library study zone? I learn better with a whiteboard.',
  },
  {
    id: 's4',
    tutorId: 't1',
    tutorName: 'Daniel Hartono',
    studentId: 'u1',
    studentName: 'Nathan Andrew',
    subject: 'Programming Fundamentals',
    topic: 'Recursion and memory ownership',
    date: offlineSlot.date,
    time: offlineSlot.slot.time,
    mode: offlineSlot.slot.mode,
    location: offlineSlot.slot.location,
    status: 'Pending',
    notes: 'I want to walk through RAII step by step with a whiteboard.',
  },
];

export const INITIAL_REQUESTS = [
  {
    id: 'r1',
    tutorId: 't1',
    sessionId: 's2',
    tutorName: 'Daniel Hartono',
    studentId: 'u2',
    studentName: 'Mikaela Putri',
    studentInitials: 'MP',
    subject: 'Advanced C++',
    topic: 'Pointers and memory ownership',
    date: onlineSlot.date,
    time: onlineSlot.slot.time,
    mode: onlineSlot.slot.mode,
    location: onlineSlot.slot.location,
    status: 'Pending',
    custom: false,
    message: 'I understand the syntax but still get lost when debugging ownership issues.',
  },
  {
    id: 'r2',
    tutorId: 't1',
    sessionId: 's3',
    tutorName: 'Daniel Hartono',
    studentId: 'u3',
    studentName: 'Jason Tan',
    studentInitials: 'JT',
    subject: 'Programming Fundamentals',
    topic: 'Recursion and base cases',
    date: customDate,
    time: customTime,
    mode: 'Offline',
    location: CAMPUS_SPOTS[0],
    status: 'Pending',
    custom: true,
    message: 'Could we use the library study zone? I learn better with a whiteboard.',
  },
  {
    id: 'sr1',
    tutorId: 't1',
    sessionId: 's4',
    tutorName: 'Daniel Hartono',
    studentId: 'u1',
    studentName: 'Nathan Andrew',
    studentInitials: 'NA',
    subject: 'Programming Fundamentals',
    topic: 'Recursion and memory ownership',
    date: offlineSlot.date,
    time: offlineSlot.slot.time,
    mode: offlineSlot.slot.mode,
    location: offlineSlot.slot.location,
    status: 'Pending',
    custom: false,
    message: 'I want to walk through RAII step by step with a whiteboard.',
  },
];

export const NOTIFICATIONS = {
  student: [
    { id: 'n1', type: 'session', title: 'Session confirmed', body: `Hendra accepted your Linear Algebra session for ${hendraSlot.date} at ${hendraSlot.slot.time}.`, time: 'Today' },
    { id: 'n2', type: 'reminder', title: 'Session reminder', body: `Your in-person session at ${offlineSlot.slot.location} is coming up.`, time: 'Today' },
    { id: 'n3', type: 'tutor', title: 'New tutor available', body: 'A new Web Development tutor is now listed.', time: 'Yesterday' },
  ],
  tutor: [
    { id: 'n4', type: 'request', title: 'New booking request', body: `Mikaela requested Advanced C++ on ${onlineSlot.date} at ${onlineSlot.slot.time}.`, time: 'Today' },
    { id: 'n5', type: 'request', title: 'Custom time request', body: 'Jason suggested an offline Programming Fundamentals session.', time: 'Today' },
    { id: 'n6', type: 'schedule', title: 'Availability is low', body: 'You only have one open slot on 1 Oct.', time: 'Yesterday' },
  ],
};

export const CALENDAR_EVENTS = [
  { id: 'c1', date: hendraSlot.date, time: hendraSlot.slot.time, label: 'Linear Algebra', type: 'session' },
  { id: 'c2', date: offlineSlot.date, time: offlineSlot.slot.time, label: 'Programming Fundamentals', type: 'request' },
  { id: 'c3', date: '2026-10-02', time: '10:30', label: 'AI Study Community', type: 'event' },
];
