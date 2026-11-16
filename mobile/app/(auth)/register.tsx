import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { SubjectMultiSelect } from '@/components/SubjectMultiSelect';
import { ApiError } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import type { UserRole } from '@/lib/types';
import { useAuth } from '@/stores/AuthProvider';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

/**
 * Account creation against the Django backend (POST /api/register/),
 * mirroring the website's register card: a role switch plus role-specific
 * fields (major for students, teaching subjects for tutors).
 *
 * The backend only accepts username/email/password and creates every account
 * as a student, so the selected role is completed after sign-in: tutors are
 * promoted via POST /api/profile/become-tutor/ and the role-specific fields
 * are saved with the profile PATCH. Both calls live in the auth store's
 * signUp and keep the session signed in if the extra setup fails.
 */
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [role, setRole] = useState<UserRole>('student');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [major, setMajor] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleSubject(subject: string) {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject],
    );
  }

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
    if (role === 'tutor' && subjects.length === 0) {
      return 'Pick at least one subject you will teach.';
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
      await signUp(
        {
          username: username.trim(),
          email: email.trim(),
          password,
        },
        {
          role,
          fullName,
          major: role === 'student' ? major : undefined,
          subjects: role === 'tutor' ? subjects : undefined,
        },
      );
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
          <Text style={subtitleStyles}>Pick a role and set up your profile</Text>
        </View>

        <View style={roleSwitchStyles} accessibilityLabel="Choose your role">
          {roleOptions.map((option) => (
            <Pressable
              key={option.role}
              accessibilityRole="button"
              accessibilityState={{ selected: role === option.role }}
              onPress={() => {
                setRole(option.role);
                setError(null);
              }}
              style={({ pressed }) => [
                roleCardStyles,
                role === option.role ? roleCardSelectedStyles : null,
                pressed ? { opacity: 0.9 } : null,
              ]}
            >
              <Text
                style={[roleCardTitleStyles, role === option.role ? { color: colors.primaryDark } : null]}
              >
                {option.title}
              </Text>
              <Text style={roleCardCaptionStyles}>{option.caption}</Text>
            </Pressable>
          ))}
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
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            autoComplete="name"
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
          {role === 'student' ? (
            <LabeledInput
              label="Major"
              value={major}
              onChangeText={setMajor}
              placeholder="e.g. Artificial Intelligence"
              returnKeyType="next"
            />
          ) : null}
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
          {role === 'tutor' ? (
            <SubjectMultiSelect
              label="Subjects you teach"
              value={subjects}
              onToggle={toggleSubject}
              onRemove={(subject) => setSubjects((current) => current.filter((item) => item !== subject))}
              hint="Pick at least one."
            />
          ) : null}

          {error ? (
            <View style={errorBoxStyles}>
              <Text style={errorTextStyles}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label={role === 'tutor' ? 'Create tutor account' : 'Create account'}
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

const roleOptions: Array<{ role: UserRole; title: string; caption: string }> = [
  { role: 'student', title: 'Student / Mentee', caption: 'Find and book a tutor' },
  { role: 'tutor', title: 'Tutor / Mentor', caption: 'Manage requests and availability' },
];

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
  marginBottom: spacing.lg,
};

const titleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 24,
  fontWeight: '700',
};

const subtitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontSize: 14,
  marginTop: spacing.xs,
};

const roleSwitchStyles: StyleProp<ViewStyle | TextStyle> = {
  flexDirection: 'row',
  gap: spacing.sm,
  marginBottom: spacing.lg,
};

const roleCardStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flex: 1,
  gap: 3,
  padding: spacing.md,
  ...shadows.card,
};

const roleCardSelectedStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const roleCardTitleStyles: StyleProp<TextStyle> = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const roleCardCaptionStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 15,
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
