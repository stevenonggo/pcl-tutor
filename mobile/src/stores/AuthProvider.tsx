import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  becomeTutor as becomeTutorRequest,
  getProfile,
  login,
  register,
  updateProfile as patchProfile,
} from '@/lib/api';
import { clearTokens, loadStoredTokens, storeTokens } from '@/lib/tokens';
import type { ApiUser, Profile, ProfileUpdatePayload, RegisterPayload } from '@/lib/types';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  profile: Profile | null;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (payload: RegisterPayload) => Promise<void>;
  signOut: () => void;
  refreshProfile: () => Promise<Profile>;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<Profile>;
  becomeTutor: () => Promise<Profile>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromProfile(profile: Profile): ApiUser {
  return { id: profile.id, username: profile.username, email: profile.email };
}

/**
 * Global authentication state.
 *
 * On mount, tokens persisted in SecureStore are restored and validated via
 * GET /api/profile/ (which also returns the role and tutor fields).
 * Sign-in stores the SimpleJWT token pair and loads the full profile;
 * sign-out wipes the stored tokens. Route groups read `status` to gate their
 * content (see app/(auth)/_layout.tsx and app/(tabs)/_layout.tsx).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await loadStoredTokens();
      if (!tokens) {
        if (!cancelled) {
          setStatus('unauthenticated');
        }
        return;
      }
      try {
        const nextProfile = await getProfile();
        if (!cancelled) {
          setProfile(nextProfile);
          setStatus('authenticated');
        }
      } catch {
        // Expired or rejected session: forget everything and start fresh.
        clearTokens();
        if (!cancelled) {
          setStatus('unauthenticated');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const tokens = await login({ username, password });
      storeTokens(tokens);
      const nextProfile = await getProfile();
      setProfile(nextProfile);
      setStatus('authenticated');
    } catch (error) {
      // Keep the device consistent: failed sign-in must not leave tokens behind.
      clearTokens();
      setProfile(null);
      throw error;
    }
  }, []);

  const signUp = useCallback(
    async (payload: RegisterPayload) => {
      // The register endpoint does not return tokens, so registration is
      // followed by an immediate sign-in with the same credentials.
      await register(payload);
      await signIn(payload.username, payload.password);
    },
    [signIn],
  );

  const signOut = useCallback(() => {
    clearTokens();
    setProfile(null);
    setStatus('unauthenticated');
  }, []);

  const refreshProfile = useCallback(async () => {
    const nextProfile = await getProfile();
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  const updateProfile = useCallback(async (payload: ProfileUpdatePayload) => {
    const nextProfile = await patchProfile(payload);
    setProfile((current) =>
      current
        ? { ...current, ...nextProfile, email: nextProfile.email || current.email }
        : nextProfile,
    );
    return nextProfile;
  }, []);

  const becomeTutor = useCallback(async () => {
    await becomeTutorRequest();
    const nextProfile = await getProfile();
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  const value = useMemo(
    () => ({
      status,
      user: profile ? userFromProfile(profile) : null,
      profile,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      updateProfile,
      becomeTutor,
    }),
    [status, profile, signIn, signUp, signOut, refreshProfile, updateProfile, becomeTutor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the global auth state. Must be used inside an AuthProvider. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
