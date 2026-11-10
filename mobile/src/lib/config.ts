import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Base URL of the PCL Tutor Django API.
 *
 * Resolution order:
 * 1. EXPO_PUBLIC_API_BASE from .env (inlined at bundle time by Expo).
 * 2. The LAN host Expo Go is already using, with the backend's dev port.
 * 3. Platform defaults:
 *    - Android emulator reaches the host machine's localhost via 10.0.2.2.
 *    - iOS (simulator and physical) defaults to localhost.
 *
 * Expo Go on a physical phone needs the dev machine's LAN IP, e.g.
 * http://192.168.1.50:8000/api. Setting EXPO_PUBLIC_API_BASE in .env is the
 * most reliable option because the value is inlined at bundle time.
 */

const ANDROID_EMULATOR_API_BASE = 'http://10.0.2.2:8000/api';
const IOS_API_BASE = 'http://localhost:8000/api';

/**
 * Accept either a full API base ("http://host:8000/api") or a server origin
 * ("http://host:8000") and normalize both to a single, trailing-slash-free
 * value. This guards against the most common connection mistake of pointing
 * at the server root and then requesting "/register/" from the wrong path.
 */
function normalizeApiBase(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  return /\/api$/i.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

/**
 * Derive the development machine's LAN host from the Expo dev server. Expo
 * exposes it as a "host:port" pair; the Django server runs on port 8000.
 */
function expoDevHost(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null;
  const legacyConfig = Constants as unknown as {
    expoGoConfig?: { debuggerHost?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
  };
  const hostUri =
    config?.hostUri ??
    legacyConfig.expoGoConfig?.debuggerHost ??
    legacyConfig.manifest2?.extra?.expoGo?.debuggerHost ??
    '';
  const host = hostUri.split('/')[0]?.split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return null;
  }
  return host;
}

const envApiBase = normalizeApiBase(process.env.EXPO_PUBLIC_API_BASE);
const lanHost = expoDevHost();

export const API_BASE: string =
  envApiBase ??
  (lanHost
    ? `http://${lanHost}:8000/api`
    : Platform.OS === 'android'
      ? ANDROID_EMULATOR_API_BASE
      : IOS_API_BASE);
