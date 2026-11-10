import * as SecureStore from 'expo-secure-store';

import type { AuthTokens } from './types';

/**
 * Secure persistence for the SimpleJWT token pair.
 *
 * Tokens live in the device's secure storage (iOS Keychain / Android
 * Keystore-backed SecureStore) and are never written to plain AsyncStorage.
 * An in-memory cache is kept so request code can read the access token
 * synchronously without paying the async SecureStore lookup on every call.
 */
const ACCESS_KEY = 'pcl.access_token';
const REFRESH_KEY = 'pcl.refresh_token';

let cached: AuthTokens | null = null;

/** Load persisted tokens into memory. Call once when the app starts. */
export async function loadStoredTokens(): Promise<AuthTokens | null> {
  if (cached) {
    return cached;
  }
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (access && refresh) {
    cached = { access, refresh };
    return cached;
  }
  return null;
}

/** Synchronous read of the in-memory access token (null if not signed in). */
export function getAccess(): string | null {
  return cached?.access ?? null;
}

/** Synchronous read of the in-memory refresh token (null if not signed in). */
export function getRefresh(): string | null {
  return cached?.refresh ?? null;
}

/** Persist a fresh token pair to SecureStore and the in-memory cache. */
export function storeTokens(tokens: AuthTokens): void {
  cached = tokens;
  void SecureStore.setItemAsync(ACCESS_KEY, tokens.access);
  void SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh);
}

/** Forget the session everywhere (memory + SecureStore). */
export function clearTokens(): void {
  cached = null;
  void SecureStore.deleteItemAsync(ACCESS_KEY);
  void SecureStore.deleteItemAsync(REFRESH_KEY);
}
