import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAuth } from '@/stores/AuthProvider';
import { colors, spacing } from '@/theme';

/**
 * Gate for the authenticated stack routes that sit outside the tab bar
 * (tutor details, booking, availability, subjects, activity, study plan).
 */
export default function PrivateLayout() {
  const { status } = useAuth();

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === 'restoring') {
    return (
      <View style={restoringStyles}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}

const restoringStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.background,
  flex: 1,
  gap: spacing.sm,
  justifyContent: 'center',
};
