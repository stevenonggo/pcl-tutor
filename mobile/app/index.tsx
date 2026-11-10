import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '@/stores/AuthProvider';
import { colors } from '@/theme';

/**
 * Root entry route. Expo Router launches at "/" on a cold start, so this
 * screen forwards to the right group once the stored session is restored.
 */
export default function IndexScreen() {
  const { status } = useAuth();

  if (status === 'restoring') {
    return (
      <View style={loadingStyles}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Redirect href={status === 'authenticated' ? '/(tabs)/dashboard' : '/(auth)/login'} />
  );
}

const loadingStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.background,
  flex: 1,
  justifyContent: 'center',
};
