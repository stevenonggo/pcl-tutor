/// <reference types="jest" />

import {
  groupSlotsByDate,
  isActiveStatus,
  makeClientToken,
  slotLabel,
  sortSlots,
  statusLabel,
  statusTone,
} from '../src/lib/booking';
import type { AvailabilitySlot } from '../src/lib/types';

function slot(overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    id: 'slot-1',
    date: '2026-11-03',
    time: '09:00',
    mode: 'Online',
    location: '',
    duration: 60,
    reserved: false,
    reserved_session: null,
    ...overrides,
  };
}

describe('status helpers', () => {
  it('flags only pending and suggested as active', () => {
    expect(isActiveStatus('Pending')).toBe(true);
    expect(isActiveStatus('Suggested')).toBe(true);
    expect(isActiveStatus('Confirmed')).toBe(false);
    expect(isActiveStatus('Cancelled')).toBe(false);
    expect(isActiveStatus('Sealed')).toBe(false);
  });

  it('prefers the backend display status when it differs', () => {
    expect(statusLabel('Cancelled', 'Rejected')).toBe('Rejected');
    expect(statusLabel('Cancelled')).toBe('Cancelled');
    expect(statusLabel('Confirmed', 'Confirmed')).toBe('Confirmed');
  });

  it('maps statuses to visual tones', () => {
    expect(statusTone('Confirmed')).toBe('success');
    expect(statusTone('Pending')).toBe('warning');
    expect(statusTone('Suggested')).toBe('info');
    expect(statusTone('Cancelled')).toBe('danger');
    expect(statusTone('Cancelled', 'Rejected')).toBe('danger');
    expect(statusTone('Sealed')).toBe('neutral');
  });
});

describe('slot helpers', () => {
  it('sorts by start time without mutating the input', () => {
    const input = [slot({ id: 'b', time: '11:00' }), slot({ id: 'a', time: '09:00' })];
    const result = sortSlots(input);
    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
    expect(input.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('groups sorted slots by date', () => {
    const grouped = groupSlotsByDate([
      slot({ id: 'late', date: '2026-11-04', time: '10:00' }),
      slot({ id: 'first', date: '2026-11-03', time: '12:00' }),
      slot({ id: 'second', date: '2026-11-03', time: '08:00' }),
    ]);
    expect(Object.keys(grouped)).toEqual(['2026-11-03', '2026-11-04']);
    expect(grouped['2026-11-03'].map((item) => item.id)).toEqual(['second', 'first']);
  });

  it('labels slots with time, duration, mode, and offline location', () => {
    expect(slotLabel(slot())).toBe('09:00 - 60 min - Online');
    expect(slotLabel(slot({ mode: 'Offline', location: 'Library' }))).toBe(
      '09:00 - 60 min - Offline - Library',
    );
  });

  it('generates unique client tokens', () => {
    const tokens = new Set(Array.from({ length: 25 }, () => makeClientToken()));
    expect(tokens.size).toBe(25);
    for (const token of tokens) {
      expect(token.startsWith('pcl-')).toBe(true);
      expect(token.length).toBeGreaterThan(10);
    }
  });
});
