import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconBadge,
  InlineMessage,
  KeyValue,
  LoadingState,
  Screen,
  SectionHeading,
} from '@/components/ui';
import { useAsyncData } from '@/hooks/useAsyncData';
import { listActivity, listAvailability, listRequests, listSessions, listTutors } from '@/lib/api';
import { isActiveStatus, statusLabel, statusTone } from '@/lib/booking';
import { SUBJECTS } from '@/data/subjects';
import { formatDate, localDate, nextDates, relativeTime, weekdayShort, dayOfMonth } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { ActivityItem, AvailabilitySlot, Booking, TutorSummary } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

interface DashboardData {
  sessions: Booking[];
  requests: Booking[];
  activity: ActivityItem[];
  tutors: TutorSummary[];
  availabilityCounts: Record<string, number>;
  slotsToday: AvailabilitySlot[];
}

function byDateTime(a: Booking, b: Booking): number {
  return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
}

export default function DashboardScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const role = profile?.role ?? 'student';
  const isTutor = role === 'tutor';
  const displayName = profile?.full_name?.trim() || profile?.username || 'there';

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<DashboardData>(
    async () => {
      const [sessions, requests] = await Promise.all([listSessions(), listRequests()]);
      let activity: ActivityItem[] = [];
      try {
        activity = await listActivity();
      } catch {
        activity = [];
      }
      let tutors: TutorSummary[] = [];
      try {
        tutors = isTutor ? [] : await listTutors();
      } catch {
        tutors = [];
      }

      let availabilityCounts: Record<string, number> = {};
      let slotsToday: AvailabilitySlot[] = [];
      if (isTutor) {
        const dates = nextDates(5);
        const results = await Promise.all(
          dates.map(async (date) => {
            try {
              return [date, await listAvailability(date)] as const;
            } catch {
              return [date, [] as AvailabilitySlot[]] as const;
            }
          }),
        );
        availabilityCounts = Object.fromEntries(results.map(([date, slots]) => [date, slots.length]));
        slotsToday = results[0]?.[1] ?? [];
      }

      return { sessions, requests, activity, tutors, availabilityCounts, slotsToday };
    },
    [isTutor],
    { refreshOnFocus: true },
  );

  const tutorNames = useMemo(() => {
    const map = new Map<string, TutorSummary>();
    for (const tutor of data?.tutors ?? []) {
      map.set(tutor.id, tutor);
    }
    return map;
  }, [data?.tutors]);

  const upcomingSessions = useMemo(() => {
    const today = localDate();
    return [...(data?.sessions ?? [])]
      .filter((session) => session.status === 'Confirmed' && session.date >= today)
      .sort(byDateTime);
  }, [data?.sessions]);

  const nextSession = upcomingSessions[0] ?? null;
  const activeRequests = useMemo(
    () => (data?.requests ?? []).filter((request) => isActiveStatus(request.status)),
    [data?.requests],
  );
  const weekDates = useMemo(() => nextDates(5), []);

  const calendarItems = useMemo(() => {
    const sessions = (data?.sessions ?? []).map((session) => ({
      date: session.date,
      time: session.time,
      label: session.subject,
    }));
    const requests = activeRequests.map((request) => ({
      date: request.date,
      time: request.time,
      label: request.subject,
    }));
    return [...sessions, ...requests];
  }, [activeRequests, data?.sessions]);

  const goToSearch = (params: { q?: string; subject?: string }) => {
    router.push({ pathname: '/(tabs)/find', params });
  };

  const subjectShortlist = SUBJECTS.slice(0, 5);

  if (loading && !data) {
    return (
      <Screen>
        <LoadingState label="Loading your workspace..." />
      </Screen>
    );
  }

  if (error && !data) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={introStyles}>
        <View style={{ flex: 1 }}>
          <Text style={eyebrowStyles}>{isTutor ? 'Tutor workspace' : 'Student workspace'}</Text>
          <Text style={titleStyles}>Hi, {displayName.split(' ')[0]}</Text>
          <Text style={subtitleStyles}>
            {isTutor
              ? 'Keep your requests moving and your open hours visible.'
              : 'Find the right tutor and keep your study sessions in one place.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => router.push('/(tabs)/me')}
        >
          <Avatar name={displayName} accent={profile?.accent || colors.primary} size={48} />
        </Pressable>
      </View>

      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}

      <View style={actionGridStyles}>
        <ActionTile
          icon="sparkles-outline"
          title="Study Plan"
          body="Build an AI-guided plan."
          onPress={() => router.push('/(private)/study-plan')}
        />
        <ActionTile
          icon="pulse-outline"
          title="Activity"
          body="See every update."
          onPress={() => router.push('/(private)/activity')}
        />
        <ActionTile
          icon={isTutor ? 'time-outline' : 'book-outline'}
          title={isTutor ? 'Availability' : 'Subjects'}
          body={isTutor ? 'Publish open slots.' : 'Browse the catalog.'}
          onPress={() =>
            router.push(isTutor ? '/(private)/availability' : '/(private)/subjects')
          }
        />
        <ActionTile
          icon={isTutor ? 'people-outline' : 'search-outline'}
          title={isTutor ? 'Requests' : 'Find tutors'}
          body={isTutor ? 'Decide incoming requests.' : 'Search by course.'}
          onPress={() => router.push(isTutor ? '/(tabs)/requests' : '/(tabs)/find')}
        />
      </View>

      {!isTutor ? (
        <Card style={{ gap: spacing.md }}>
          <SectionHeading
            title="What do you need help with?"
            subtitle="Search a subject first, then compare tutors."
          />
          <View style={searchRowStyles}>
            <Ionicons name="search-outline" size={18} color={colors.faint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a subject or tutor"
              placeholderTextColor={colors.faint}
              returnKeyType="search"
              onSubmitEditing={() => goToSearch({ q: query })}
              style={searchInputStyles}
            />
          </View>
          <View style={chipRowStyles}>
            {subjectShortlist.map((subject) => (
              <Pressable
                key={subject}
                accessibilityRole="button"
                onPress={() => goToSearch({ subject })}
                style={({ pressed }) => [subjectChipStyles, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={subjectChipTextStyles}>{subject}</Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton
            label="Search tutors"
            onPress={() => goToSearch({ q: query })}
            style={{ marginTop: 2 }}
          />
        </Card>
      ) : null}

      <View style={twoColumnStyles}>
        <Card style={{ flex: 1 }}>
          <SectionHeading
            title="Pending requests"
            subtitle={
              activeRequests.length
                ? `${activeRequests.length} need your attention.`
                : 'Nothing is waiting right now.'
            }
            right={<Badge label={String(activeRequests.length)} tone={activeRequests.length ? 'warning' : 'success'} />}
          />
          {activeRequests.length === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title="You're all caught up."
              body={isTutor ? 'New student requests will appear here.' : 'Your pending requests will appear here.'}
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {activeRequests.slice(0, 2).map((request) => (
                <Pressable
                  key={request.id}
                  accessibilityRole="button"
                  onPress={() => router.push('/(tabs)/requests')}
                  style={({ pressed }) => [requestRowStyles, pressed ? { opacity: 0.8 } : null]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={requestTitleStyles} numberOfLines={1}>
                      {isTutor ? request.student_name || 'Student' : request.subject}
                    </Text>
                    <Text style={requestMetaStyles} numberOfLines={1}>
                      {request.topic || request.subject}
                    </Text>
                    <Text style={requestDateStyles}>
                      {formatDate(request.date)} at {request.time}
                    </Text>
                  </View>
                  <Badge
                    label={statusLabel(request.status, request.display_status)}
                    tone={statusTone(request.status, request.display_status)}
                  />
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/requests')}
            style={({ pressed }) => [linkButtonStyles, pressed ? { opacity: 0.7 } : null]}
          >
            <Text style={linkTextStyles}>Open requests</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primaryDark} />
          </Pressable>
        </Card>

        <Card style={{ flex: 1 }}>
          <SectionHeading
            title={isTutor ? 'Upcoming session' : 'Next session'}
            subtitle={nextSession ? nextSession.subject : 'No confirmed session yet.'}
            right={
              nextSession ? (
                <Badge label="Confirmed" tone="success" />
              ) : undefined
            }
          />
          {nextSession ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={requestTitleStyles}>{nextSession.topic || nextSession.subject}</Text>
              <KeyValue label="When" value={`${formatDate(nextSession.date)} at ${nextSession.time}`} strong />
              <KeyValue
                label="Mode"
                value={
                  nextSession.mode === 'Offline' && nextSession.location
                    ? `Offline - ${nextSession.location}`
                    : nextSession.mode
                }
              />
              {!isTutor ? (
                <View style={personRowStyles}>
                  <Avatar
                    name={tutorNames.get(nextSession.tutor)?.full_name || 'Tutor'}
                    accent={tutorNames.get(nextSession.tutor)?.accent || colors.primary}
                    size={34}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={personNameStyles}>
                      {tutorNames.get(nextSession.tutor)?.full_name || 'Your tutor'}
                    </Text>
                    <Text style={personMetaStyles}>
                      {tutorNames.get(nextSession.tutor)?.major || 'PCL Tutor'}
                    </Text>
                  </View>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/sessions')}
                style={({ pressed }) => [linkButtonStyles, pressed ? { opacity: 0.7 } : null]}
              >
                <Text style={linkTextStyles}>See all sessions</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.primaryDark} />
              </Pressable>
            </View>
          ) : (
            <EmptyState
              icon="calendar-outline"
              title="No session yet"
              body={
                isTutor
                  ? 'Confirmed student sessions will appear here.'
                  : 'Once a tutor confirms your request it will appear here.'
              }
              action={
                <PrimaryButton
                  label={isTutor ? 'Open availability' : 'Find a tutor'}
                  onPress={() => router.push(isTutor ? '/(private)/availability' : '/(tabs)/find')}
                />
              }
            />
          )}
        </Card>
      </View>

      {isTutor ? (
        <Card>
          <SectionHeading
            title="This week"
            subtitle="Published slots across the next five days."
            right={
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/(private)/availability')}
              >
                <Text style={linkTextStyles}>Manage</Text>
              </Pressable>
            }
          />
          <View style={weekRowStyles}>
            {weekDates.map((date) => {
              const count = data?.availabilityCounts[date] ?? 0;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  onPress={() => router.push('/(private)/availability')}
                  style={({ pressed }) => [weekDayStyles, pressed ? { opacity: 0.8 } : null]}
                >
                  <Text style={weekDayLabelStyles}>{weekdayShort(date)}</Text>
                  <Text style={weekDayNumberStyles}>{dayOfMonth(date)}</Text>
                  <Text style={weekDayCountStyles}>{count}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={hintStyles}>
            {data?.slotsToday.length ?? 0} published slot
            {(data?.slotsToday.length ?? 0) === 1 ? '' : 's'} today.
          </Text>
        </Card>
      ) : null}

      <Card>
        <SectionHeading title="Calendar snapshot" subtitle="Your next five days at a glance." />
        <View style={weekRowStyles}>
          {weekDates.map((date) => {
            const items = calendarItems
              .filter((item) => item.date === date)
              .sort((a, b) => a.time.localeCompare(b.time));
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/sessions')}
                style={({ pressed }) => [
                  weekDayStyles,
                  items.length ? weekDayActiveStyles : null,
                  pressed ? { opacity: 0.8 } : null,
                ]}
              >
                <Text style={items.length ? weekDayLabelActiveStyles : weekDayLabelStyles}>
                  {weekdayShort(date)}
                </Text>
                <Text style={items.length ? weekDayNumberActiveStyles : weekDayNumberStyles}>
                  {dayOfMonth(date)}
                </Text>
                <Text style={items.length ? weekDayCountActiveStyles : weekDayCountStyles}>
                  {items[0]?.time || 'Open'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <SectionHeading
          title="Recent activity"
          subtitle="Updates from your requests and sessions."
          right={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(private)/activity')}
            >
              <Text style={linkTextStyles}>See all</Text>
            </Pressable>
          }
        />
        {(data?.activity.length ?? 0) === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="No updates yet."
            body="Updates will appear here as requests and sessions change."
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {(data?.activity ?? []).slice(0, 3).map((item) => (
              <View key={item.id} style={activityRowStyles}>
                <IconBadge icon="pulse-outline" tone="neutral" size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={activityTextStyles}>{item.text}</Text>
                  <Text style={activityTimeStyles}>{relativeTime(item.at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

function ActionTile({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [actionTileStyles, pressed ? { opacity: 0.85 } : null]}
    >
      <IconBadge icon={icon} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={actionTitleStyles}>{title}</Text>
        <Text style={actionBodyStyles} numberOfLines={2}>
          {body}
        </Text>
      </View>
    </Pressable>
  );
}

const introStyles = {
  alignItems: 'flex-start' as const,
  flexDirection: 'row' as const,
  gap: spacing.md,
};

const eyebrowStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 1.3,
  marginBottom: 3,
  textTransform: 'uppercase' as const,
};

const titleStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 26,
  fontWeight: '600' as const,
  letterSpacing: -0.6,
};

const subtitleStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 19,
  marginTop: 4,
};

const actionGridStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: spacing.sm,
};

const actionTileStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  minWidth: '47%' as const,
  padding: spacing.sm,
  ...shadows.card,
};

const actionTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const actionBodyStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 15,
  marginTop: 1,
};

const searchRowStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  minHeight: 46,
  paddingHorizontal: 12,
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

const subjectChipStyles = {
  backgroundColor: colors.primarySoft,
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 6,
};

const subjectChipTextStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '700' as const,
};

const twoColumnStyles = {
  gap: spacing.md,
};

const requestRowStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderRadius: radii.md,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.sm,
};

const requestTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700' as const,
};

const requestMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
};

const requestDateStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '600' as const,
};

const linkButtonStyles = {
  alignItems: 'center' as const,
  alignSelf: 'flex-start' as const,
  flexDirection: 'row' as const,
  gap: 4,
  paddingVertical: 4,
};

const linkTextStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const personRowStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const personNameStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const personMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
};

const weekRowStyles = {
  flexDirection: 'row' as const,
  gap: 6,
};

const weekDayStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flex: 1,
  gap: 1,
  paddingVertical: 8,
};

const weekDayActiveStyles = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const weekDayLabelStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
};

const weekDayLabelActiveStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
};

const weekDayNumberStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600' as const,
};

const weekDayNumberActiveStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600' as const,
};

const weekDayCountStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '600' as const,
};

const weekDayCountActiveStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '600' as const,
};

const hintStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
};

const activityRowStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const activityTextStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 18,
};

const activityTimeStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  marginTop: 1,
};
