import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAuth } from '@/stores/AuthProvider';
import { colors, fonts, spacing } from '@/theme';

/**
 * expo-router hands the tab bar a ColorValue (string | number | native),
 * but Ionicons only accepts string | NativeColorValue - normalize to a
 * concrete string to satisfy both sides.
 */
function tabBarColor(color: unknown): string {
  return typeof color === 'string' ? color : colors.primaryDark;
}

/**
 * Gate for the private (tabs) group: unauthenticated visitors are sent to
 * sign-in; while the stored session is being restored a full-screen loader
 * is shown instead of flashing the wrong screen.
 */
export default function TabsLayout() {
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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.faint,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 7,
          paddingTop: 5,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={tabBarColor(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="find"
        options={{
          title: 'Find',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={tabBarColor(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="swap-horizontal-outline" size={size} color={tabBarColor(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={tabBarColor(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={tabBarColor(color)} />
          ),
        }}
      />
    </Tabs>
  );
}

const restoringStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.background,
  flex: 1,
  justifyContent: 'center',
  gap: spacing.sm,
};
