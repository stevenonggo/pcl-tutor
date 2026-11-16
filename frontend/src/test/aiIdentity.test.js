import { beforeEach, describe, expect, it } from 'vitest';
import { getDeviceIdentity } from '../lib/aiIdentity';
import { STORAGE_KEYS } from '../lib/storage';

// The device identity is login-independent localStorage state: generated
// once, stable forever, and never influenced by the PCL session.
describe('aiIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a UUID-4 and keeps it across calls', () => {
    const first = getDeviceIdentity();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getDeviceIdentity()).toBe(first);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.aiIdentity))).toBe(first);
  });

  it('is independent of the persisted PCL user', () => {
    localStorage.setItem(STORAGE_KEYS.legacyUser, JSON.stringify({ role: 'student', name: 'Local', token: '' }));
    const first = getDeviceIdentity();

    localStorage.setItem(STORAGE_KEYS.legacyUser, JSON.stringify({ role: 'tutor', name: 'Signed In', token: 'jwt-token-1' }));
    expect(getDeviceIdentity()).toBe(first); // signing in never changes it

    localStorage.removeItem(STORAGE_KEYS.legacyUser); // … and signing out does not either
    expect(getDeviceIdentity()).toBe(first);
  });

  it('replaces a corrupted stored value with a fresh UUID-4', () => {
    localStorage.setItem(STORAGE_KEYS.aiIdentity, JSON.stringify('not-a-uuid'));
    const fresh = getDeviceIdentity();
    expect(fresh).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fresh).not.toBe('not-a-uuid');
    expect(getDeviceIdentity()).toBe(fresh); // the replacement is now stable
  });
});
