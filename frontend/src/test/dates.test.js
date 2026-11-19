import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  datesForWeek,
  formatShort,
  nextDates,
  parseISODate,
  startOfWeekISO,
  toISODate,
  todayISO,
  weekdayShort,
} from '../lib/dates';

// Every date-based view defaults through this one module, so pinning the
// helpers here pins the default behaviour of all of them at once. The
// assertions use explicit anchors so they hold on any machine date.

describe('toISODate / todayISO (local parts, never UTC)', () => {
  it('formats a Date from local parts', () => {
    expect(toISODate(new Date(2026, 10, 18))).toBe('2026-11-18');
  });

  it('todayISO is the user\'s current local date', () => {
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});

describe('parseISODate', () => {
  it('parses a local date at noon, no timezone shift', () => {
    const date = parseISODate('2026-11-18');
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2026, 11, 18]);
  });
});

describe('addDaysISO', () => {
  it('adds whole days in local time across month boundaries', () => {
    expect(addDaysISO('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDaysISO('2026-11-30', 2)).toBe('2026-12-02');
  });

  it('moves backwards', () => {
    expect(addDaysISO('2026-11-16', -7)).toBe('2026-11-09');
  });
});

describe('startOfWeekISO (Monday weeks)', () => {
  it('is the Monday of the week for a mid-week anchor', () => {
    expect(startOfWeekISO('2026-11-18')).toBe('2026-11-16');
  });

  it('treats Sunday as the last day of its week', () => {
    expect(startOfWeekISO('2026-11-22')).toBe('2026-11-16');
  });

  it('is itself when the anchor is a Monday', () => {
    expect(startOfWeekISO('2026-11-16')).toBe('2026-11-16');
  });
});

describe('datesForWeek', () => {
  it('returns the seven days of the anchored week, Monday first', () => {
    expect(datesForWeek(0, '2026-11-18')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });

  it('offsets whole weeks from the anchor', () => {
    expect(datesForWeek(-1, '2026-11-18')[0]).toBe('2026-11-09');
    expect(datesForWeek(1, '2026-11-18')[0]).toBe('2026-11-23');
  });

  it('defaults the anchor to the user\'s current local date', () => {
    expect(datesForWeek(0)).toEqual(datesForWeek(0, todayISO()));
    expect(datesForWeek(-3)).toEqual(datesForWeek(-3, todayISO()));
  });
});

describe('nextDates', () => {
  it('counts forward from the anchor, including it', () => {
    expect(nextDates(3, '2026-11-18')).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
  });

  it('defaults the anchor to the user\'s current local date', () => {
    expect(nextDates(5)).toEqual(nextDates(5, todayISO()));
  });
});

describe('format helpers', () => {
  it('formats a short label from the local date', () => {
    expect(formatShort('2026-11-18')).toBe('Wed, Nov 18');
    expect(weekdayShort('2026-11-18')).toBe('Wed');
  });

  it('formats an empty date to an empty string', () => {
    expect(formatShort('')).toBe('');
    expect(formatShort(null)).toBe('');
  });
});
