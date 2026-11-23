import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEYS, writeJson } from '../lib/storage';
import {
  addDaysISO,
  datesForWeek,
  formatShort,
  parseISODate,
  todayISO,
  weekdayShort,
} from '../lib/dates';
import { makeSlot } from '../lib/slots';
import { STUDENT, TUTOR, renderApp, signInAs } from './helpers';

// On page entry, every date-based view must initialize from the user's current
// local date — the calendar week, the selected day, and the date pickers. These
// tests pin that contract per page. Stored records (demo slots below) keep
// their own dates and are reached by navigating, never shifted.

const today = todayISO();
const tomorrow = addDaysISO(today, 1);

// A tutor with real slots on the user's current local date, so the defaults
// land on days that actually have content.
const demoTutor = {
  id: 't1',
  name: 'Demo Tutor',
  initials: 'DT',
  accent: '#0B8F68',
  subjects: ['C'],
  major: 'Computer Science',
  rating: 4.8,
  sessions: 30,
  participantsToday: 2,
};

function seedDb({ withTutorRecord = false } = {}) {
  writeJson(STORAGE_KEYS.db, {
    students: [],
    // With an email, the mount-time upsert (which matches on id or email)
    // cannot absorb the record, so the panel keeps keying off the demo tutor
    // id — which is the availability key.
    tutors: withTutorRecord ? [{ ...demoTutor, email: 'demo.tutor@example.com' }] : [],
    sessions: [],
    requests: [],
    availability: {
      t1: {
        [today]: [
          makeSlot({ time: '09:00', mode: 'Online' }),
          makeSlot({ time: '14:00', mode: 'Offline', location: 'Library study zone, 2nd floor' }),
        ],
        [tomorrow]: [makeSlot({ time: '10:00', mode: 'Online' })],
      },
    },
  });
}

describe('calendar workspace (sessions / availability pages)', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(STUDENT);
  });

  it('opens on the user\'s current week with today selected', () => {
    seedDb();
    renderApp('/sessions');

    const week = datesForWeek(0);
    expect(document.querySelector('.calendar-workspace-head h2'))
      .toHaveTextContent(`${formatShort(week[0])} — ${formatShort(week[6])}`);
    expect(within(document.querySelector('.agenda-panel')).getByRole('heading', { level: 3 }))
      .toHaveTextContent(formatShort(today));
    const firstDay = document.querySelector('.week-day');
    expect(firstDay).toHaveTextContent(weekdayShort(week[0]));
    expect(firstDay).toHaveTextContent(String(parseISODate(week[0]).getDate()));
  });

  it('moves the selected day with the week, and "This week" returns to today', async () => {
    seedDb();
    renderApp('/sessions');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(within(document.querySelector('.agenda-panel')).getByRole('heading', { level: 3 }))
      .toHaveTextContent(formatShort(datesForWeek(1)[0]));

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(within(document.querySelector('.agenda-panel')).getByRole('heading', { level: 3 }))
      .toHaveTextContent(formatShort(today));
  });

  it('keeps a deep-linked day as the day to open', () => {
    seedDb();
    renderApp(`/sessions?date=${tomorrow}`);

    // The deep link is an explicit choice: it is preserved in the note, and the
    // shared helper formats it (this also guards the removed local formatter).
    expect(document.querySelector('.calendar-deep-link-note')).toHaveTextContent(formatShort(tomorrow));
  });
});

describe('dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts the student quick calendar at the user\'s current local date', () => {
    seedDb();
    signInAs(STUDENT);
    renderApp('/');

    const first = document.querySelector('.mini-day');
    expect(first).toHaveTextContent(weekdayShort(today));
    expect(first).toHaveTextContent(String(parseISODate(today).getDate()));
  });

  it('starts the tutor availability week at the user\'s current local date', () => {
    seedDb({ withTutorRecord: true });
    signInAs(TUTOR);
    renderApp('/');

    // The snapshot grid shows one button per day; the first is today. It shows
    // the weekday and the stored open-slot count for that day — today has two.
    const first = document.querySelector('.availability-snapshot-grid button');
    expect(first).toHaveTextContent(weekdayShort(today));
    expect(first.querySelector('strong')).toHaveTextContent('2');
    expect(first).toHaveTextContent('open slots');
  });
});

describe('booking form', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(STUDENT);
  });

  it('defaults the schedule to the user\'s current local date', async () => {
    seedDb({ withTutorRecord: true });
    renderApp('/booking?tutor=t1');
    const user = userEvent.setup();

    // The date control is a chip group for a short list; today must be the
    // checked choice, not the first day the tutor happens to publish.
    const dateChips = await screen.findByRole('radiogroup', { name: 'Date' });
    expect(within(dateChips).getByRole('radio', { name: formatShort(today) }))
      .toHaveAttribute('aria-checked', 'true');

    // The day it lands on is also the day whose slots are offered.
    await user.click(screen.getByRole('button', { name: /available time/i }));
    const panel = screen.getByRole('radiogroup', { name: 'Available time' });
    expect(panel).toHaveTextContent('09:00 · Online');
    expect(panel).toHaveTextContent('14:00 · Offline · Library study zone, 2nd floor');
  });

  it('lets an explicit URL date win over the default', async () => {
    seedDb({ withTutorRecord: true });
    renderApp(`/booking?tutor=t1&date=${tomorrow}`);

    const dateChips = await screen.findByRole('radiogroup', { name: 'Date' });
    expect(within(dateChips).getByRole('radio', { name: formatShort(tomorrow) }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('starts the custom-time date picker at the user\'s current local date', async () => {
    seedDb({ withTutorRecord: true });
    renderApp('/booking?tutor=t1');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /custom time/i }));
    expect(screen.getByLabelText(/^date$/i)).toHaveValue(today);
  });

  it('starts the tutor publishing form at the user\'s current local date', () => {
    localStorage.clear();
    signInAs(TUTOR);
    renderApp('/booking');

    expect(screen.getByLabelText(/^date$/i)).toHaveValue(today);
  });
});

describe('tutor profile day strip', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(STUDENT);
  });

  it('opens the day strip at the user\'s current local date and selects it', () => {
    seedDb({ withTutorRecord: true });
    renderApp('/tutor/t1');

    const firstDay = document.querySelector('.profile-mini-day');
    expect(firstDay).toHaveTextContent(weekdayShort(today));
    expect(firstDay).toHaveTextContent(String(parseISODate(today).getDate()));

    // Today is the selected day, so its published slots are the ones shown.
    const panel = document.querySelector('.selected-date-panel');
    expect(within(panel).getByText(formatShort(today))).toBeInTheDocument();
    const grid = document.querySelector('.slot-button-grid');
    expect(within(grid).getByText('09:00')).toBeInTheDocument();
    expect(within(grid).getByText('14:00')).toBeInTheDocument();

    // A day further out shows its own stored count — records are not shifted.
    const days = document.querySelectorAll('.profile-mini-day');
    expect(days[1]).toHaveTextContent(weekdayShort(tomorrow));
    expect(days[1]).toHaveTextContent('1 open');
  });
});
