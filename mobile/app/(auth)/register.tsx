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
 * Account creation against the Django backend (POST /api/register/).
 * The backend requires username, email, and a password of at least 8
 * characters; registration signs the user in immediately afterwards.
 */
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (username.trim().length < 2) {
      return 'Enter a username (at least 2 characters).';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Enter a valid email address.';
    }
    if (password.length < 8) {
      return 'Use a password with at least 8 characters.';
    }
    if (password !== confirm) {
      return 'Passwords do not match.';
    }
    return null;
  }

  async function handleSubmit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signUp({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      // Success: the (auth) group layout redirects to the tabs.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the account. Check the API address and try again.',
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
          <Text style={titleStyles}>Create your account</Text>
          <Text style={subtitleStyles}>One account for students and tutors</Text>
        </View>

        <View style={formStyles}>
          <LabeledInput
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="Choose a username"
            autoCapitalize="none"
            autoComplete="username"
            returnKeyType="next"
          />
          <LabeledInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="next"
          />
          <LabeledInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            hint="The backend requires a minimum of 8 characters."
            returnKeyType="next"
          />
          <LabeledInput
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repeat your password"
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
            label="Create account"
            loading={submitting}
            onPress={handleSubmit}
            style={{ marginTop: spacing.sm }}
          />
        </View>

        <Text style={footerStyles}>
          Already have an account?{' '}
          <Link href="/(auth)/login" style={{ color: colors.primaryDark, fontWeight: '600' }}>
            Sign in
          </Link>
        </Text>

        <Text style={apiNoteStyles}>{`Registering against ${API_BASE}`}</Text>
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
  fontSize: 24,
  fontWeight: '700',
};

const subtitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontSize: 14,
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
