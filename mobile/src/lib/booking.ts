import type { AvailabilitySlot, BookingStatus } from './types';

/** Hourly choices shared by custom bookings and tutor availability forms. */
export const TIME_CHOICES = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
] as const;

export const DURATION_CHOICES = [30, 60, 90] as const;

/** Statuses that still need a decision from one of the participants. */
export function isActiveStatus(status: BookingStatus): boolean {
  return status === 'Pending' || status === 'Suggested';
}

/** Human-readable status, matching the web app's Rejected/Cancelled split. */
export function statusLabel(status: BookingStatus, displayStatus?: string): string {
  if (displayStatus && displayStatus !== status) {
    return displayStatus;
  }
  if (status === 'Cancelled') {
    return 'Cancelled';
  }
  return status;
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Visual tone for a booking status badge. */
export function statusTone(status: BookingStatus, displayStatus?: string): Tone {
  const label = statusLabel(status, displayStatus);
  if (label === 'Confirmed') {
    return 'success';
  }
  if (label === 'Pending') {
    return 'warning';
  }
  if (label === 'Suggested') {
    return 'info';
  }
  if (label === 'Rejected' || label === 'Cancelled') {
    return 'danger';
  }
  return 'neutral';
}

/** Sort slots by start time without mutating the original array. */
export function sortSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  return [...slots].sort((a, b) => a.time.localeCompare(b.time));
}

/** Group next-7-day slots by date, preserving date order. */
export function groupSlotsByDate(slots: AvailabilitySlot[]): Record<string, AvailabilitySlot[]> {
  const grouped: Record<string, AvailabilitySlot[]> = {};
  for (const slot of sortSlots(slots)) {
    grouped[slot.date] = grouped[slot.date] ?? [];
    grouped[slot.date].push(slot);
  }
  return grouped;
}

/**
 * Idempotency token for a booking intent. The backend requires a non-empty
 * client_token and reuses the same request when it is retried.
 */
export function makeClientToken(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `pcl-${Date.now().toString(36)}-${random}`;
}

/** "09:00 - 60 minutes" style slot label. */
export function slotLabel(slot: AvailabilitySlot): string {
  const place = slot.mode === 'Offline' && slot.location ? ` - ${slot.location}` : '';
  return `${slot.time} - ${slot.duration} min - ${slot.mode}${place}`;
}
