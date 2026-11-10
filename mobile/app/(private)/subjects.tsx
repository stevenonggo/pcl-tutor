import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import {
  Badge,
  Card,
  EmptyState,
  InlineMessage,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { SUBJECTS } from '@/data/subjects';
import { filterSubjects } from '@/lib/subjects';
import { useAuth } from '@/stores/AuthProvider';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

export default function SubjectsScreen() {
  const router = useRouter();
  const { profile, updateProfile } = useAuth();
  const isTutor = profile?.role === 'tutor';

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(profile?.subjects ?? []);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(profile?.subjects ?? []);
  }, [profile?.subjects]);

  const visible = useMemo(() => filterSubjects(query), [query]);

  function toggle(subject: string) {
    setFeedback(null);
    setSelected((current) =>
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject],
    );
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await updateProfile({ subjects: selected });
      setFeedback(
        selected.length
          ? `Saved ${selected.length} subject${selected.length === 1 ? '' : 's'} to your tutor profile.`
          : 'Your teaching list is now empty.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save subjects.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        eyebrow={isTutor ? 'Tutor profile' : 'Subject catalog'}
        title={isTutor ? 'Subjects you teach' : 'Browse subjects'}
        subtitle={
          isTutor
            ? 'Keep this list accurate so students can find you for the right course.'
            : 'Pick a course to search the tutor library for that subject.'
        }
        right={
          isTutor ? (
            <Badge label={`${selected.length} selected`} tone={selected.length ? 'success' : 'neutral'} />
          ) : undefined
        }
        onBack={() => router.back()}
        homeLink
      />

      {feedback ? <InlineMessage tone="success">{feedback}</InlineMessage> : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}

      <View style={searchRowStyles}>
        <Ionicons name="search-outline" size={18} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search the subject catalog"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          style={searchInputStyles}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery('')}
          >
            <Ionicons name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>

      {isTutor ? (
        <Card style={{ gap: spacing.md }}>
          <SectionHeading
            title="Current teaching list"
            subtitle={
              selected.length
                ? `${selected.length} subject${selected.length === 1 ? '' : 's'} on your profile.`
                : 'Add at least one subject so students can discover you.'
            }
          />
          {selected.length ? (
            <View style={chipRowStyles}>
              {selected.map((subject) => (
                <Badge key={subject} label={subject} tone="success" />
              ))}
            </View>
          ) : (
            <Text style={mutedStyles}>No subjects selected yet.</Text>
          )}
          <PrimaryButton
            label={saving ? 'Saving...' : 'Save subjects'}
            loading={saving}
            onPress={save}
          />
        </Card>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <SectionHeading
          title="Subject catalog"
          subtitle={
            isTutor
              ? 'Tap a subject to include or remove it from your tutor profile.'
              : 'Tap a subject to find tutors who teach it.'
          }
        />
        {visible.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title="No subjects match that search."
            body="Try another keyword or clear the search."
          />
        ) : (
          visible.map((subject) => {
            const isSelected = selected.includes(subject) && isTutor;
            return (
              <Pressable
                key={subject}
                accessibilityRole="button"
                accessibilityState={isTutor ? { selected: isSelected } : undefined}
                onPress={() =>
                  isTutor
                    ? toggle(subject)
                    : router.push({
                        pathname: '/(tabs)/find',
                        params: { subject },
                      })
                }
                style={({ pressed }) => [
                  subjectRowStyles,
                  isSelected ? subjectRowSelectedStyles : null,
                  pressed ? { opacity: 0.82 } : null,
                ]}
              >
                {isTutor ? (
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={isSelected ? colors.primary : colors.faint}
                  />
                ) : (
                  <View style={subjectIconStyles}>
                    <Ionicons name="book-outline" size={16} color={colors.primaryDark} />
                  </View>
                )}
                <Text style={subjectTextStyles}>{subject}</Text>
                {!isTutor ? (
                  <Ionicons name="arrow-forward" size={15} color={colors.faint} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </Card>

      {!isTutor ? (
        <Card tone="neutral">
          <SectionHeading
            title="Not sure where to start?"
            subtitle="Search all tutors and compare their experience and open slots."
          />
          <PrimaryButton label="Browse all tutors" onPress={() => router.push('/(tabs)/find')} />
        </Card>
      ) : null}
    </Screen>
  );
}

const searchRowStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  minHeight: 46,
  paddingHorizontal: 12,
  ...shadows.card,
};

const searchInputStyles = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 15,
  paddingVertical: 8,
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

const subjectRowStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  minHeight: 46,
  paddingHorizontal: spacing.sm,
};

const subjectRowSelectedStyles = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const subjectIconStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primarySoft,
  borderRadius: 15,
  height: 30,
  justifyContent: 'center' as const,
  width: 30,
};

const subjectTextStyles = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '600' as const,
};
