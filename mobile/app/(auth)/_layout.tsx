import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/stores/AuthProvider';

/**
 * Gate for the public (auth) group: a signed-in user is redirected straight
 * to the tab stack instead of seeing login/register again.
 */
export default function AuthLayout() {
  const { status } = useAuth();

  if (status === 'authenticated') {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
