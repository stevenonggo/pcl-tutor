import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Link } from 'expo-router';

import { LabeledInput } from '@/components/LabeledInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ApiError } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { useAuth } from '@/stores/AuthProvider';
import { colors, radii, spacing } from '@/theme';

/**
 * Sign-in against the Django backend (POST /api/login/, SimpleJWT).
 * On success the (auth) group layout redirects into the tab stack.
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      // Success: the (auth) group layout redirects to the tabs.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not sign in. Check the API address and try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={screenStyles}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={contentStyles} keyboardShouldPersistTaps="handled">
        <View style={brandStyles}>
          <Text style={titleStyles}>PCL Tutor</Text>
          <Text style={subtitleStyles}>Sign in to your learning workspace</Text>
        </View>

        <View style={formStyles}>
          <LabeledInput
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="Your username"
            autoCapitalize="none"
            autoComplete="username"
            keyboardType="default"
            returnKeyType="next"
          />
          <LabeledInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {error ? (
            <View style={errorBoxStyles}>
              <Text style={errorTextStyles}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label="Sign in"
            loading={submitting}
            onPress={handleSubmit}
            style={{ marginTop: spacing.sm }}
          />
        </View>

        <Text style={footerStyles}>
          No account yet?{' '}
          <Link href="/(auth)/register" style={{ color: colors.primaryDark, fontWeight: '600' }}>
            Register
          </Link>
        </Text>

        <Text style={apiNoteStyles}>{`Signing in to ${API_BASE}`}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const screenStyles: StyleProp<ViewStyle | TextStyle> = {
  flex: 1,
  backgroundColor: colors.background,
};

const contentStyles: StyleProp<ViewStyle | TextStyle> = {
  flexGrow: 1,
  justifyContent: 'center',
  padding: spacing.lg,
};

const brandStyles: StyleProp<ViewStyle | TextStyle> = {
  marginBottom: spacing.xl,
};

const titleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontSize: 28,
  fontWeight: '700',
};

const subtitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontSize: 15,
  marginTop: spacing.xs,
};

const formStyles: StyleProp<ViewStyle | TextStyle> = {
  gap: spacing.md,
};

const errorBoxStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.dangerSoft,
  borderRadius: radii.md,
  borderColor: colors.danger,
  borderWidth: 1,
  padding: spacing.md,
};

const errorTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.danger,
  fontSize: 13,
};

const footerStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontSize: 14,
  marginTop: spacing.lg,
  textAlign: 'center',
};

const apiNoteStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontSize: 11,
  marginTop: spacing.md,
  textAlign: 'center',
  opacity: 0.8,
};
