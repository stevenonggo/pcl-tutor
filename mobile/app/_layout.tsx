import { ActivityIndicator, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/stores/AuthProvider';
import { colors, fonts, spacing } from '@/theme';

/**
 * Load the brand fonts (Inter + Plus Jakarta Sans) that match the web app's
 * typography. While they load the root shows a simple splash view; if the
 * fonts fail to load the app proceeds on system fonts instead of blocking.
 */
function useBrandFonts() {
  const [fontsLoaded, fontError] = useFonts({
    [fonts.body]: require('../assets/fonts/inter.ttf'),
    [fonts.heading]: require('../assets/fonts/plus-jakarta-sans.ttf'),
  });
  return fontsLoaded || Boolean(fontError);
}

/**
 * Root layout: wraps the app in the auth provider and mounts the (auth) and
 * (tabs) route groups. The groups are mutually exclusive through the auth
 * gate in each group layout.
 */
export default function RootLayout() {
  const fontsReady = useBrandFonts();

  if (!fontsReady) {
    return (
      <View style={splashStyles}>
        <Text style={splashTitleStyles}>PCL Tutor</Text>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(private)" />
      </Stack>
      <StatusBar style="dark" />
    </AuthProvider>
  );
}

const splashStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.background,
  flex: 1,
  gap: spacing.md,
  justifyContent: 'center',
};

const splashTitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 20,
  fontWeight: '600',
  letterSpacing: -0.4,
};
