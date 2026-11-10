/// <reference types="jest" />

import {
  dayOfMonth,
  formatDate,
  formatDateLong,
  isValidDate,
  isTodayOrLater,
  localDate,
  monthShort,
  nextDates,
  relativeTime,
  shortDate,
  weekdayShort,
} from '../src/lib/datetime';

describe('localDate / nextDates', () => {
  it('returns a local ISO date without UTC shifting', () => {
    expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    expect(localDate()).toBe(expected);
  });

  it('offsets by whole days', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    expect(localDate(1)).toBe(expected);
  });

  it('builds consecutive date lists', () => {
    const dates = nextDates(3);
    expect(dates).toHaveLength(3);
    expect(dates[0]).toBe(localDate());
    expect(dates[1]).toBe(localDate(1));
    expect(dates[2]).toBe(localDate(2));
  });
});

describe('isValidDate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidDate('2026-11-03')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('2026-1-3')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2025-02-29')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats the weekday, day, and short month', () => {
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
      new Date(2026, 10, 3).getDay()
    ];
    expect(formatDate('2026-11-03')).toBe(`${weekday}, 3 Nov`);
    expect(formatDateLong('2026-11-03')).toContain('3 Nov 2026');
  });

  it('exposes the date parts used by the UI', () => {
    expect(weekdayShort('2026-11-03')).toHaveLength(3);
    expect(dayOfMonth('2026-11-03')).toBe('3');
    expect(monthShort('2026-11-03')).toBe('Nov');
    expect(shortDate('2026-11-03')).toBe('3 Nov');
  });

  it('falls back to the raw value for invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('')).toBe('No date');
  });
});

describe('relativeTime', () => {
  it('returns an empty string for missing or invalid timestamps', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('nope')).toBe('');
  });

  it('describes recent and older timestamps', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });
});

describe('isTodayOrLater', () => {
  it('compares against the local date string', () => {
    expect(isTodayOrLater(localDate())).toBe(true);
    expect(isTodayOrLater(localDate(1))).toBe(true);
    expect(isTodayOrLater(localDate(-1))).toBe(false);
  });
});
