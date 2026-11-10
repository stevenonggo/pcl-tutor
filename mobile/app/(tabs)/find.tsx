import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import {
  Avatar,
  Badge,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  ScreenHeader,
} from '@/components/ui';
import { SUBJECTS } from '@/data/subjects';
import { useAsyncData } from '@/hooks/useAsyncData';
import { listTutors } from '@/lib/api';
import type { TutorSummary } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

type SortMode = 'Recommended' | 'Rating' | 'Sessions';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function matches(tutor: TutorSummary, query: string, subject: string | null): boolean {
  const needle = query.trim().toLowerCase();
  if (needle) {
    const haystack = [
      tutor.full_name,
      tutor.username,
      tutor.major,
      ...(tutor.subjects ?? []),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  if (subject && !(tutor.subjects ?? []).includes(subject)) {
    return false;
  }
  return true;
}

export default function FindTutorsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; subject?: string }>();
  const initialQuery = firstParam(params.q);
  const initialSubject = firstParam(params.subject);

  const [query, setQuery] = useState(initialQuery);
  const [subject, setSubject] = useState<string | null>(initialSubject || null);
  const [sort, setSort] = useState<SortMode>('Recommended');
  const [showAllSubjects, setShowAllSubjects] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
    setSubject(initialSubject || null);
  }, [initialQuery, initialSubject]);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<TutorSummary[]>(
    () => listTutors(),
    [],
    { refreshOnFocus: true },
  );

  const tutors = useMemo(() => {
    const filtered = (data ?? []).filter((tutor) => matches(tutor, query, subject));
    return [...filtered].sort((a, b) => {
      if (sort === 'Rating') {
        return b.rating - a.rating;
      }
      if (sort === 'Sessions') {
        return b.sessions_count - a.sessions_count;
      }
      return b.rating - a.rating || b.sessions_count - a.sessions_count;
    });
  }, [data, query, sort, subject]);

  const visibleSubjects = showAllSubjects ? SUBJECTS : SUBJECTS.slice(0, 7);
  const activeFilter = query.trim().length > 0 || Boolean(subject);

  const reset = () => {
    setQuery('');
    setSubject(null);
    setSort('Recommended');
  };

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow="Tutor discovery"
        title="Find the right tutor"
        subtitle="Search your course, compare experience, then open a profile to book a visible slot."
      />

      <View style={searchRowStyles}>
        <Ionicons name="search-outline" size={18} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search a subject or tutor"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          returnKeyType="search"
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

      <View style={filterBlockStyles}>
        <Text style={filterLabelStyles}>Subject</Text>
        <View style={chipRowStyles}>
          <Chip label="All subjects" selected={!subject} onPress={() => setSubject(null)} />
          {visibleSubjects.map((item) => (
            <Chip
              key={item}
              label={item}
              selected={subject === item}
              onPress={() => setSubject(subject === item ? null : item)}
            />
          ))}
          <Chip
            label={showAllSubjects ? 'Show less' : 'More subjects'}
            onPress={() => setShowAllSubjects((value) => !value)}
          />
        </View>
      </View>

      <View style={filterBlockStyles}>
        <Text style={filterLabelStyles}>Sort by</Text>
        <View style={chipRowStyles}>
          {(['Recommended', 'Rating', 'Sessions'] as SortMode[]).map((option) => (
            <Chip
              key={option}
              label={option}
              selected={sort === option}
              onPress={() => setSort(option)}
            />
          ))}
        </View>
      </View>

      {loading && !data ? <LoadingState label="Loading tutors..." /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {!loading && !error ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={resultCountStyles}>
            {tutors.length} tutor{tutors.length === 1 ? '' : 's'} available
            {subject ? ` for ${subject}` : ''}
          </Text>

          {tutors.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title={(data?.length ?? 0) === 0 ? 'No tutors registered yet.' : 'No tutor matches that search.'}
              body={
                (data?.length ?? 0) === 0
                  ? 'Tutor profiles will appear here once tutors join.'
                  : 'Try another subject or reset the filters.'
              }
              action={
                activeFilter ? (
                  <PrimaryButton label="Reset filters" onPress={reset} />
                ) : undefined
              }
            />
          ) : (
            tutors.map((tutor) => (
              <TutorCard
                key={tutor.id}
                tutor={tutor}
                onPress={() =>
                  router.push({
                    pathname: '/(private)/tutor/[id]',
                    params: { id: tutor.id },
                  })
                }
              />
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function TutorCard({ tutor, onPress }: { tutor: TutorSummary; onPress: () => void }) {
  const name = tutor.full_name?.trim() || tutor.username;
  const subjectList = tutor.subjects ?? [];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [tutorCardStyles, pressed ? { opacity: 0.88 } : null]}
    >
      <View style={tutorHeadStyles}>
        <Avatar name={name} accent={tutor.accent || colors.primary} size={50} />
        <View style={{ flex: 1 }}>
          <Text style={tutorNameStyles}>{name}</Text>
          <Text style={tutorMetaStyles} numberOfLines={1}>
            {[tutor.major || 'PCL Tutor', tutor.semester ? `Semester ${tutor.semester}` : '']
              .filter(Boolean)
              .join(' - ')}
          </Text>
          <View style={tutorStatsStyles}>
            <Ionicons name="star" size={12} color="#D97706" />
            <Text style={tutorStatStyles}>{tutor.rating ? tutor.rating.toFixed(1) : 'New'}</Text>
            <Text style={tutorStatDividerStyles}>|</Text>
            <Text style={tutorStatStyles}>{tutor.sessions_count} sessions</Text>
          </View>
        </View>
        <Badge
          label={`${tutor.open_slots_next_7d} open`}
          tone={tutor.open_slots_next_7d > 0 ? 'success' : 'neutral'}
        />
      </View>

      {tutor.bio ? (
        <Text style={tutorBioStyles} numberOfLines={2}>
          {tutor.bio}
        </Text>
      ) : null}

      <View style={chipRowStyles}>
        {subjectList.slice(0, 3).map((item) => (
          <Badge key={item} label={item} tone="neutral" />
        ))}
        {subjectList.length > 3 ? (
          <Badge label={`+${subjectList.length - 3} more`} tone="info" />
        ) : null}
      </View>

      <View style={tutorFooterStyles}>
        <Text style={tutorFooterTextStyles}>View profile and available slots</Text>
        <Ionicons name="arrow-forward" size={15} color={colors.primaryDark} />
      </View>
    </Pressable>
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

const filterBlockStyles = {
  gap: spacing.sm,
};

const filterLabelStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 1.2,
  textTransform: 'uppercase' as const,
};

const chipRowStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: 6,
};

const resultCountStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600' as const,
};

const tutorCardStyles = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.sm,
  padding: spacing.md,
  ...shadows.card,
};

const tutorHeadStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const tutorNameStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 17,
  fontWeight: '600' as const,
  letterSpacing: -0.3,
};

const tutorMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
};

const tutorStatsStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: 4,
  marginTop: 2,
};

const tutorStatStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '600' as const,
};

const tutorStatDividerStyles = {
  color: colors.borderStrong,
  fontFamily: fonts.body,
  fontSize: 11,
};

const tutorBioStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 19,
};

const tutorFooterStyles = {
  alignItems: 'center' as const,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
  paddingTop: spacing.sm,
};

const tutorFooterTextStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '700' as const,
};
