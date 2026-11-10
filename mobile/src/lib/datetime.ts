/** Date helpers that avoid UTC off-by-one shifts by working with local parts. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date as YYYY-MM-DD, optionally offset by whole days. */
export function localDate(offsetDays = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A list of consecutive local dates starting today (or an offset). */
export function nextDates(count: number, startOffset = 0): string[] {
  return Array.from({ length: count }, (_, index) => localDate(startOffset + index));
}

/** True for a syntactically valid YYYY-MM-DD calendar date. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function parseLocal(value: string): Date | null {
  if (!isValidDate(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** "Mon, 3 Nov" - the compact format used across the web app. */
export function formatDate(value: string): string {
  const date = parseLocal(value);
  if (!date) {
    return value || 'No date';
  }
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Monday, 3 November 2026". */
export function formatDateLong(value: string): string {
  const date = parseLocal(value);
  if (!date) {
    return value || 'No date';
  }
  return `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function weekdayShort(value: string): string {
  const date = parseLocal(value);
  return date ? WEEKDAYS[date.getDay()] : '';
}

export function dayOfMonth(value: string): string {
  const date = parseLocal(value);
  return date ? String(date.getDate()) : '';
}

export function monthShort(value: string): string {
  const date = parseLocal(value);
  return date ? MONTHS[date.getMonth()] : '';
}

/** "3 Nov" without a weekday. */
export function shortDate(value: string): string {
  const date = parseLocal(value);
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()]}` : value;
}

/** Format an ISO timestamp from the API as a compact relative time. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) {
    return '';
  }
  const diffMs = Date.now() - when.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return formatDate(local);
}

/** True when the YYYY-MM-DD date is today or later. */
export function isTodayOrLater(value: string): boolean {
  return value >= localDate();
}
