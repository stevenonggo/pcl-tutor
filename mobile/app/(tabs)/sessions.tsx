import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingState,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { useAsyncData } from '@/hooks/useAsyncData';
import { listSessions, listTutors } from '@/lib/api';
import { formatDate, localDate, monthShort, dayOfMonth, weekdayShort } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { Booking, TutorSummary } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

interface SessionsData {
  sessions: Booking[];
  tutors: TutorSummary[];
}

function byDateTime(a: Booking, b: Booking): number {
  return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
}

export default function SessionsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const isTutor = profile?.role === 'tutor';

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<SessionsData>(
    async () => {
      const sessions = await listSessions();
      let tutors: TutorSummary[] = [];
      if (!isTutor) {
        try {
          tutors = await listTutors();
        } catch {
          tutors = [];
        }
      }
      return { sessions, tutors };
    },
    [isTutor],
    { refreshOnFocus: true },
  );

  const tutorMap = useMemo(() => {
    const map = new Map<string, TutorSummary>();
    for (const tutor of data?.tutors ?? []) {
      map.set(tutor.id, tutor);
    }
    return map;
  }, [data?.tutors]);

  const today = localDate();
  const sessions = useMemo(
    () => [...(data?.sessions ?? [])].sort(byDateTime),
    [data?.sessions],
  );
  const upcoming = useMemo(
    () => sessions.filter((session) => session.date >= today),
    [sessions, today],
  );
  const past = useMemo(
    () => sessions.filter((session) => session.date < today).reverse(),
    [sessions, today],
  );
  const nextSession = upcoming[0] ?? null;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow={isTutor ? 'Teaching schedule' : 'My learning schedule'}
        title={isTutor ? 'Your sessions' : 'My sessions'}
        subtitle={
          isTutor
            ? 'Confirmed sessions in one focused place, separate from pending requests.'
            : 'A focused place for your confirmed study sessions.'
        }
        right={
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(isTutor ? '/(private)/availability' : '/(tabs)/find')}
            style={({ pressed }) => [headerActionStyles, pressed ? { opacity: 0.85 } : null]}
          >
            <Ionicons name={isTutor ? 'add' : 'search'} size={15} color={colors.surface} />
            <Text style={headerActionTextStyles}>{isTutor ? 'Slots' : 'Find'}</Text>
          </Pressable>
        }
        homeLink
      />

      {loading && !data ? <LoadingState label="Loading sessions..." /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {!loading || data ? (
        <>
          <Card style={{ gap: spacing.sm }}>
            <SectionHeading
              title="Schedule overview"
              subtitle={
                nextSession
                  ? `Next up: ${nextSession.subject} on ${formatDate(nextSession.date)}.`
                  : 'No confirmed sessions yet.'
              }
            />
            <View style={statRowStyles}>
              <Stat label="Upcoming" value={String(upcoming.length)} />
              <Stat label="Completed" value={String(past.length)} />
              <Stat label="This week" value={String(
                upcoming.filter((session) => session.date <= localDateOffset(6)).length,
              )} />
            </View>
          </Card>

          <Card style={{ gap: spacing.md }}>
            <SectionHeading
              title="Upcoming sessions"
              subtitle="Confirmed sessions that are still ahead."
            />
            {upcoming.length === 0 ? (
              <EmptyState
                icon="calendar-outline"
                title="No sessions yet."
                body="Once a request is confirmed, it will appear here."
                action={
                  <PrimaryButton
                    label={isTutor ? 'Manage availability' : 'Find a tutor'}
                    onPress={() =>
                      router.push(isTutor ? '/(private)/availability' : '/(tabs)/find')
                    }
                  />
                }
              />
            ) : (
              <View style={{ gap: spacing.md }}>
                {upcoming.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isTutor={isTutor}
                    tutor={tutorMap.get(session.tutor)}
                  />
                ))}
              </View>
            )}
          </Card>

          {past.length > 0 ? (
            <Card style={{ gap: spacing.sm }}>
              <SectionHeading
                title="Past sessions"
                subtitle="Confirmed sessions from earlier dates."
              />
              {past.slice(0, 12).map((session) => (
                <View key={session.id} style={pastRowStyles}>
                  <View style={{ flex: 1 }}>
                    <Text style={pastTitleStyles}>{session.subject}</Text>
                    <Text style={pastMetaStyles} numberOfLines={1}>
                      {formatDate(session.date)} at {session.time} - {session.mode}
                    </Text>
                  </View>
                  <Badge label="Confirmed" tone="success" />
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function localDateOffset(days: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={statStyles}>
      <Text style={statValueStyles}>{value}</Text>
      <Text style={statLabelStyles}>{label}</Text>
    </View>
  );
}

function SessionCard({
  session,
  isTutor,
  tutor,
}: {
  session: Booking;
  isTutor: boolean;
  tutor?: TutorSummary;
}) {
  const tutorName = tutor?.full_name?.trim() || tutor?.username || 'Your tutor';
  return (
    <View style={sessionCardStyles}>
      <View style={sessionDateStyles}>
        <Text style={sessionMonthStyles}>{monthShort(session.date)}</Text>
        <Text style={sessionDayStyles}>{dayOfMonth(session.date)}</Text>
        <Text style={sessionWeekdayStyles}>{weekdayShort(session.date)}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={sessionHeadStyles}>
          <Text style={sessionTitleStyles} numberOfLines={1}>
            {session.subject}
          </Text>
          <Badge label="Confirmed" tone="success" />
        </View>
        <Text style={sessionTopicStyles} numberOfLines={2}>
          {session.topic || 'No topic provided.'}
        </Text>
        <KeyValue label="When" value={`${formatDate(session.date)} at ${session.time}`} strong />
        <KeyValue
          label="Mode"
          value={
            session.mode === 'Offline' && session.location
              ? `Offline - ${session.location}`
              : session.mode
          }
        />
        <KeyValue label="Duration" value={`${session.duration} minutes`} />
        {!isTutor ? (
          <View style={sessionTutorStyles}>
            <Avatar name={tutorName} accent={tutor?.accent || colors.primary} size={28} />
            <Text style={sessionTutorTextStyles}>{tutorName}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const headerActionStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primary,
  borderRadius: radii.button,
  flexDirection: 'row' as const,
  gap: 4,
  minHeight: 38,
  paddingHorizontal: 12,
};

const headerActionTextStyles = {
  color: colors.surface,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const statRowStyles = {
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const statStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flex: 1,
  gap: 1,
  paddingVertical: spacing.sm,
};

const statValueStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 20,
  fontWeight: '600' as const,
};

const statLabelStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '600' as const,
};

const sessionCardStyles = {
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.md,
  padding: spacing.md,
  ...shadows.card,
};

const sessionDateStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primarySoft,
  borderRadius: radii.md,
  height: 62,
  justifyContent: 'center' as const,
  width: 52,
};

const sessionMonthStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
};

const sessionDayStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.heading,
  fontSize: 20,
  fontWeight: '600' as const,
};

const sessionWeekdayStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '600' as const,
};

const sessionHeadStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const sessionTitleStyles = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600' as const,
};

const sessionTopicStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  lineHeight: 17,
};

const sessionTutorStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: 6,
  marginTop: 2,
};

const sessionTutorTextStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600' as const,
};

const pastRowStyles = {
  alignItems: 'center' as const,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  paddingTop: spacing.sm,
};

const pastTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const pastMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  marginTop: 1,
};
