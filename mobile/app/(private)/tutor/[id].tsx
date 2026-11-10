import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { DateStrip } from '@/components/DateStrip';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  InlineMessage,
  KeyValue,
  LoadingState,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { useAsyncData } from '@/hooks/useAsyncData';
import { getTutor } from '@/lib/api';
import { groupSlotsByDate } from '@/lib/booking';
import { formatDate, localDate, nextDates } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { TutorDetail } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function TutorDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const tutorId = firstParam(params.id);
  const { profile } = useAuth();
  const isStudent = (profile?.role ?? 'student') === 'student';

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<TutorDetail>(
    () => getTutor(tutorId),
    [tutorId],
  );

  const [selectedDate, setSelectedDate] = useState(localDate());

  const grouped = useMemo(() => groupSlotsByDate(data?.slots ?? []), [data?.slots]);
  const weekDates = useMemo(() => {
    const dates = nextDates(7);
    for (const date of Object.keys(grouped)) {
      if (!dates.includes(date)) {
        dates.push(date);
      }
    }
    return dates;
  }, [grouped]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        weekDates.map((date) => [date, (grouped[date] ?? []).filter((slot) => !slot.reserved).length]),
      ),
    [grouped, weekDates],
  );

  useEffect(() => {
    if (!data) {
      return;
    }
    const withSlots = weekDates.find((date) => (grouped[date]?.length ?? 0) > 0);
    setSelectedDate(withSlots ?? localDate());
    // Only re-run when a new tutor payload arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading && !data) {
    return (
      <Screen>
        <ScreenHeader title="Tutor profile" onBack={() => router.back()} homeLink />
        <LoadingState label="Loading tutor profile..." />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <ScreenHeader title="Tutor profile" onBack={() => router.back()} homeLink />
        <ErrorState message={error ?? 'This tutor could not be found.'} onRetry={reload} />
      </Screen>
    );
  }

  const name = data.full_name?.trim() || data.username;
  const modes = Array.from(new Set((data.slots ?? []).map((slot) => slot.mode)));
  const dateSlots = grouped[selectedDate] ?? [];
  const availableSlots = dateSlots.filter((slot) => !slot.reserved);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow="Tutor profile"
        title={name}
        subtitle={[data.major || 'PCL Tutor', data.semester ? `Semester ${data.semester}` : '']
          .filter(Boolean)
          .join(' - ')}
        onBack={() => router.back()}
        homeLink
      />

      <Card style={{ gap: spacing.md }}>
        <View style={heroStyles}>
          <Avatar name={name} accent={data.accent || colors.primary} size={64} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={heroNameStyles}>{name}</Text>
            <View style={heroStatsStyles}>
              <Ionicons name="star" size={13} color="#D97706" />
              <Text style={heroStatStyles}>
                {data.rating ? `${data.rating.toFixed(1)} rating` : 'New tutor'}
              </Text>
              <Text style={heroDotStyles}>-</Text>
              <Text style={heroStatStyles}>{data.sessions_count} sessions</Text>
            </View>
            <Badge
              label={`${data.open_slots_next_7d} open slot${data.open_slots_next_7d === 1 ? '' : 's'} this week`}
              tone={data.open_slots_next_7d > 0 ? 'success' : 'neutral'}
            />
          </View>
        </View>

        <Text style={bioStyles}>
          {data.bio?.trim() || 'This tutor has not added a bio yet.'}
        </Text>

        <View style={{ gap: 6 }}>
          <Text style={labelStyles}>Subjects</Text>
          <View style={chipRowStyles}>
            {(data.subjects ?? []).length ? (
              data.subjects.map((subject) => <Badge key={subject} label={subject} tone="info" />)
            ) : (
              <Text style={mutedStyles}>No subjects added yet.</Text>
            )}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={labelStyles}>Formats</Text>
          <View style={chipRowStyles}>
            {modes.length ? (
              modes.map((mode) => (
                <Badge key={mode} label={mode} tone={mode === 'Online' ? 'success' : 'warning'} />
              ))
            ) : (
              <Text style={mutedStyles}>No published formats yet.</Text>
            )}
          </View>
        </View>

        {isStudent ? (
          <View style={{ gap: spacing.sm }}>
            <PrimaryButton
              label="Request a custom time"
              onPress={() =>
                router.push({
                  pathname: '/(private)/booking',
                  params: { tutorId: data.id, custom: '1' },
                })
              }
            />
            <Text style={hintStyles}>
              Published slots below can be booked directly. A custom request lets the tutor
              suggest a different time if needed.
            </Text>
          </View>
        ) : (
          <InlineMessage tone="neutral">
            You are viewing this profile as a tutor. Only student accounts can book sessions.
          </InlineMessage>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading
          title="Availability"
          subtitle="Choose a day, then tap an open time to start a booking."
        />
        <DateStrip
          dates={weekDates}
          selected={selectedDate}
          onSelect={setSelectedDate}
          counts={counts}
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={selectedDateStyles}>{formatDate(selectedDate)}</Text>
          {dateSlots.length === 0 ? (
            <EmptyState
              icon="calendar-clear-outline"
              title="No published times"
              body="This tutor has not published a slot on this day."
              action={
                isStudent ? (
                  <PrimaryButton
                    label="Ask for a custom time"
                    onPress={() =>
                      router.push({
                        pathname: '/(private)/booking',
                        params: { tutorId: data.id, custom: '1' },
                      })
                    }
                  />
                ) : undefined
              }
            />
          ) : availableSlots.length === 0 ? (
            <EmptyState
              icon="lock-closed-outline"
              title="All slots are reserved"
              body="Every published time on this day is already held by a request."
            />
          ) : (
            availableSlots.map((slot) => (
              <Pressable
                key={slot.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/(private)/booking',
                    params: {
                      tutorId: data.id,
                      slotId: slot.id,
                      custom: '0',
                    },
                  })
                }
                style={({ pressed }) => [slotRowStyles, pressed ? { opacity: 0.85 } : null]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={slotTimeStyles}>{slot.time}</Text>
                  <Text style={slotMetaStyles}>
                    {slot.mode}
                    {slot.mode === 'Offline' && slot.location ? ` - ${slot.location}` : ''}
                  </Text>
                  <Text style={slotDurationStyles}>{slot.duration} minutes</Text>
                </View>
                <View style={slotRightStyles}>
                  <Badge label={slot.mode} tone={slot.mode === 'Online' ? 'success' : 'warning'} />
                  <Ionicons name="arrow-forward" size={16} color={colors.primaryDark} />
                </View>
              </Pressable>
            ))
          )}
        </View>
      </Card>

      <Card>
        <SectionHeading title="Profile details" subtitle="What this tutor can help with." />
        <KeyValue label="Major" value={data.major || 'Not set'} />
        <KeyValue label="Semester" value={data.semester || 'Not set'} />
        <KeyValue label="Sessions completed" value={String(data.sessions_count)} />
        <KeyValue
          label="Open slots next 7 days"
          value={String(data.open_slots_next_7d)}
        />
      </Card>
    </Screen>
  );
}

const heroStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.md,
};

const heroNameStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 20,
  fontWeight: '600' as const,
  letterSpacing: -0.4,
};

const heroStatsStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: 4,
  marginBottom: 4,
};

const heroStatStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600' as const,
};

const heroDotStyles = {
  color: colors.borderStrong,
  fontSize: 12,
};

const bioStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 14,
  lineHeight: 21,
};

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

const hintStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 16,
  textAlign: 'center' as const,
};

const selectedDateStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '700' as const,
};

const slotRowStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.md,
  ...shadows.card,
};

const slotTimeStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 17,
  fontWeight: '600' as const,
};

const slotMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  marginTop: 1,
};

const slotDurationStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  marginTop: 1,
};

const slotRightStyles = {
  alignItems: 'flex-end' as const,
  gap: 6,
};
