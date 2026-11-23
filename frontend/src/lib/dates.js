// Shared date helpers for every date-based view (calendar week, selected day,
// date pickers, booking, dashboard). All ISO dates are built from LOCAL parts,
// never toISOString(), so the app never shifts a day in timezones ahead of UTC.
//
// Views initialize from the user's current local date; stored records (sessions,
// requests, published availability) keep their own dates and are reached by
// navigating weeks instead.

/** Format a Date as a local YYYY-MM-DD string. */
export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The user's current local date as YYYY-MM-DD. */
export function todayISO() {
  return toISODate(new Date());
}

/** Parse a YYYY-MM-DD string into a local Date at noon (avoids DST edges). */
export function parseISODate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

/** Add n days to a YYYY-MM-DD string, staying in local time. */
export function addDaysISO(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Monday of the calendar week that contains `anchorISO` (default: today). */
export function startOfWeekISO(anchorISO = todayISO()) {
  const date = parseISODate(anchorISO);
  const weekday = date.getDay(); // 0=Sunday .. 6=Saturday
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diffToMonday);
  return toISODate(date);
}

/**
 * The 7 days of the calendar week `offset` weeks from the week containing
 * `anchorISO` (default: this week). The anchor stays local-today, so week 0
 * is always the week the user is in now.
 */
export function datesForWeek(offset = 0, anchorISO = todayISO()) {
  const start = addDaysISO(startOfWeekISO(anchorISO), offset * 7);
  return Array.from({ length: 7 }, (_, index) => addDaysISO(start, index));
}

/** The next `count` days starting from `anchorISO` (default: today). */
export function nextDates(count, anchorISO = todayISO()) {
  return Array.from({ length: count }, (_, index) => addDaysISO(anchorISO, index));
}

/** "Mon, Nov 18" style label for a YYYY-MM-DD date. */
export function formatShort(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseISODate(iso));
}

/** "Mon" style label for a YYYY-MM-DD date. */
export function weekdayShort(iso) {
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(parseISODate(iso));
}
