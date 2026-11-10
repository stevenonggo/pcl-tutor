import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ConfirmModal } from '@/components/ConfirmModal';
import { LabeledInput } from '@/components/LabeledInput';
import {
  Avatar,
  Badge,
  Card,
  Chip,
  InlineMessage,
  KeyValue,
  LabeledTextArea,
  LoadingState,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { API_BASE } from '@/lib/config';
import { useAuth } from '@/stores/AuthProvider';
import { colors, fonts, radii, spacing } from '@/theme';

const ACCENTS = ['#0B8F68', '#3568C8', '#7A5AF8', '#D97706', '#475569', '#0F766E'] as const;

interface Shortcut {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  route: string;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile, becomeTutor, signOut } = useAuth();

  const [fullName, setFullName] = useState('');
  const [major, setMajor] = useState('');
  const [semester, setSemester] = useState('');
  const [bio, setBio] = useState('');
  const [accent, setAccent] = useState<string>(colors.primary);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTutor, setConfirmTutor] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!profile) {
      return;
    }
    setFullName(profile.full_name ?? '');
    setMajor(profile.major ?? '');
    setSemester(profile.semester ?? '');
    setBio(profile.bio ?? '');
    setAccent(profile.accent || colors.primary);
  }, [profile]);

  if (!profile) {
    return (
      <Screen>
        <ScreenHeader title="Profile" homeLink />
        <LoadingState label="Loading your profile..." />
      </Screen>
    );
  }

  const isTutor = profile.role === 'tutor';
  const displayName = profile.full_name?.trim() || profile.username;

  async function save() {
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await updateProfile({ full_name: fullName, major, semester, bio, accent });
      setFeedback('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmBecomeTutor() {
    setPromoting(true);
    setFeedback(null);
    setError(null);
    try {
      await becomeTutor();
      setFeedback('Your account is now a tutor account. You can publish availability.');
      setConfirmTutor(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch to a tutor account.');
      setConfirmTutor(false);
    } finally {
      setPromoting(false);
    }
  }

  const shortcuts: Shortcut[] = isTutor
    ? [
        { icon: 'time-outline', title: 'Availability', body: 'Publish open slots.', route: '/(private)/availability' },
        { icon: 'swap-horizontal-outline', title: 'Requests', body: 'Respond to students.', route: '/(tabs)/requests' },
        { icon: 'book-outline', title: 'Subjects', body: 'Manage your teaching list.', route: '/(private)/subjects' },
        { icon: 'calendar-outline', title: 'Sessions', body: 'See your teaching schedule.', route: '/(tabs)/sessions' },
        { icon: 'pulse-outline', title: 'Activity', body: 'Review recent updates.', route: '/(private)/activity' },
        { icon: 'sparkles-outline', title: 'Study Plan', body: 'Build an AI-guided plan.', route: '/(private)/study-plan' },
      ]
    : [
        { icon: 'search-outline', title: 'Find a tutor', body: 'Start a subject search.', route: '/(tabs)/find' },
        { icon: 'calendar-outline', title: 'My sessions', body: 'See your schedule.', route: '/(tabs)/sessions' },
        { icon: 'swap-horizontal-outline', title: 'My requests', body: 'Review pending bookings.', route: '/(tabs)/requests' },
        { icon: 'book-outline', title: 'Subjects', body: 'Browse the catalog.', route: '/(private)/subjects' },
        { icon: 'pulse-outline', title: 'Activity', body: 'Review recent updates.', route: '/(private)/activity' },
        { icon: 'sparkles-outline', title: 'Study Plan', body: 'Build an AI-guided plan.', route: '/(private)/study-plan' },
      ];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Your account"
        title="Profile"
        subtitle="Keep your details current so tutors and students know who they are meeting."
        right={<Avatar name={displayName} accent={accent} size={48} />}
        homeLink
      />

      {feedback ? <InlineMessage tone="success">{feedback}</InlineMessage> : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}

      <Card style={{ gap: spacing.md }}>
        <View style={identityStyles}>
          <Avatar name={displayName} accent={accent} size={62} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={identityNameStyles}>{displayName}</Text>
            <Text style={identityMetaStyles}>{profile.email}</Text>
            <View style={identityBadgeRowStyles}>
              <Badge label={isTutor ? 'Tutor / Mentor' : 'Student / Mentee'} tone={isTutor ? 'info' : 'success'} />
              {profile.is_demo ? <Badge label="Demo" tone="neutral" /> : null}
            </View>
          </View>
        </View>
        <KeyValue label="Username" value={profile.username} />
        <KeyValue label="Rating" value={profile.rating ? profile.rating.toFixed(1) : 'New'} />
        <KeyValue label="Sessions" value={String(profile.sessions_count)} />
        {isTutor ? (
          <View style={{ gap: 6 }}>
            <Text style={labelStyles}>Teaching subjects</Text>
            <View style={chipRowStyles}>
              {(profile.subjects ?? []).length ? (
                profile.subjects.map((subject) => (
                  <Badge key={subject} label={subject} tone="info" />
                ))
              ) : (
                <Text style={mutedStyles}>No subjects selected yet.</Text>
              )}
            </View>
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="Edit your profile" subtitle="Changes are saved to your PCL Tutor account." />
        <LabeledInput label="Full name" value={fullName} onChangeText={setFullName} placeholder="Your full name" />
        <LabeledInput label="Major" value={major} onChangeText={setMajor} placeholder="e.g. Artificial Intelligence" />
        <LabeledInput
          label="Semester"
          value={semester}
          onChangeText={setSemester}
          placeholder="e.g. 3"
          keyboardType="number-pad"
        />
        <LabeledTextArea
          label="Short bio"
          value={bio}
          onChangeText={setBio}
          placeholder="Tell students how you like to learn or teach."
          minHeight={90}
        />
        <View style={{ gap: spacing.sm }}>
          <Text style={labelStyles}>Profile accent</Text>
          <View style={chipRowStyles}>
            {ACCENTS.map((option) => (
              <Chip
                key={option}
                label={option === accent ? 'Selected' : 'Use'}
                selected={accent === option}
                onPress={() => setAccent(option)}
              />
            ))}
          </View>
        </View>
        <PrimaryButton label={saving ? 'Saving...' : 'Save changes'} loading={saving} onPress={save} />
      </Card>

      {!isTutor ? (
        <Card tone="neutral" style={{ gap: spacing.sm }}>
          <SectionHeading
            title="Want to tutor?"
            subtitle="Switch your student account to a tutor account and publish availability."
          />
          <InlineMessage tone="info">
            This switches your account role permanently. You can still book sessions with other
            tutors from a second student account.
          </InlineMessage>
          <PrimaryButton label="Become a tutor" onPress={() => setConfirmTutor(true)} />
        </Card>
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionHeading title="Shortcuts" subtitle="Go somewhere useful." />
        <View style={shortcutGridStyles}>
          {shortcuts.map((shortcut) => (
            <Pressable
              key={shortcut.title}
              accessibilityRole="button"
              onPress={() => router.push(shortcut.route as never)}
              style={({ pressed }) => [shortcutStyles, pressed ? { opacity: 0.82 } : null]}
            >
              <View style={shortcutIconStyles}>
                <Ionicons name={shortcut.icon} size={17} color={colors.primaryDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={shortcutTitleStyles}>{shortcut.title}</Text>
                <Text style={shortcutBodyStyles} numberOfLines={2}>
                  {shortcut.body}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionHeading title="Session" />
        <KeyValue label="API target" value={API_BASE} />
        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          style={({ pressed }) => [signOutStyles, pressed ? { opacity: 0.82 } : null]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={signOutTextStyles}>Sign out</Text>
        </Pressable>
      </Card>

      <ConfirmModal
        visible={confirmTutor}
        title="Become a tutor?"
        message="Your account role will change from student to tutor. You will be able to publish availability and receive booking requests."
        confirmLabel="Become a tutor"
        loading={promoting}
        onConfirm={confirmBecomeTutor}
        onCancel={() => setConfirmTutor(false)}
      />
    </Screen>
  );
}

const labelStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 1.1,
  textTransform: 'uppercase' as const,
};

const chipRowStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: 6,
};

const mutedStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
};

const identityStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.md,
};

const identityNameStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 20,
  fontWeight: '600' as const,
  letterSpacing: -0.4,
};

const identityMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
};

const identityBadgeRowStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: 6,
  marginTop: 2,
};

const shortcutGridStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: spacing.sm,
};

const shortcutStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  minWidth: '47%' as const,
  padding: spacing.sm,
};

const shortcutIconStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primarySoft,
  borderRadius: 16,
  height: 32,
  justifyContent: 'center' as const,
  width: 32,
};

const shortcutTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '700' as const,
};

const shortcutBodyStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 10,
  lineHeight: 14,
  marginTop: 1,
};

const signOutStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.dangerSoft,
  borderColor: colors.danger,
  borderRadius: radii.button,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: 8,
  justifyContent: 'center' as const,
  minHeight: 46,
};

const signOutTextStyles = {
  color: colors.danger,
  fontFamily: fonts.body,
  fontSize: 15,
  fontWeight: '700' as const,
};
