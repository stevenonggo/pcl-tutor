import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DateStrip } from '@/components/DateStrip';
import { LabeledInput } from '@/components/LabeledInput';
import { SelectField } from '@/components/SelectField';
import {
  Avatar,
  Badge,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  InlineMessage,
  KeyValue,
  LabeledTextArea,
  LoadingState,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ApiError, createBooking, getTutor, listTutors } from '@/lib/api';
import {
  groupSlotsByDate,
  makeClientToken,
  sortSlots,
  TIME_CHOICES,
} from '@/lib/booking';
import { formatDate, isValidDate, localDate, nextDates } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { Booking, BookingMode, TutorDetail, TutorSummary } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

interface BookingData {
  tutors: TutorSummary[];
  tutor: TutorDetail | null;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function BookingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tutorId?: string;
    slotId?: string;
    custom?: string;
  }>();
  const { profile } = useAuth();
  const initialTutorId = firstParam(params.tutorId);
  const initialSlotId = firstParam(params.slotId);
  const initialCustom = firstParam(params.custom) === '1';

  const [tutorId, setTutorId] = useState(initialTutorId);
  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<BookingData>(
    async () => {
      const tutors = await listTutors();
      const selectedId = tutorId || tutors[0]?.id || '';
      const tutor = selectedId ? await getTutor(selectedId) : null;
      return { tutors, tutor };
    },
    [tutorId],
  );

  const tutor = data?.tutor ?? null;
  const isStudent = (profile?.role ?? 'student') === 'student';

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [customMode, setCustomMode] = useState(initialCustom);
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [selectedSlotId, setSelectedSlotId] = useState(initialSlotId);
  const [customDate, setCustomDate] = useState(localDate());
  const [customTime, setCustomTime] = useState('');
  const [mode, setMode] = useState<BookingMode>('Online');
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [success, setSuccess] = useState<Booking | null>(null);

  const tokenRef = useRef(makeClientToken());

  const grouped = useMemo(() => groupSlotsByDate(tutor?.slots ?? []), [tutor?.slots]);
  const weekDates = useMemo(() => {
    const dates = nextDates(7);
    for (const date of Object.keys(grouped)) {
      if (!dates.includes(date)) {
        dates.push(date);
      }
    }
    return dates;
  }, [grouped]);

  const slotCounts = useMemo(
    () =>
      Object.fromEntries(
        weekDates.map((date) => [date, (grouped[date] ?? []).filter((slot) => !slot.reserved).length]),
      ),
    [grouped, weekDates],
  );

  const dateSlots = useMemo(() => sortSlots(grouped[selectedDate] ?? []), [grouped, selectedDate]);
  const selectedSlot = useMemo(
    () => (tutor?.slots ?? []).find((slot) => slot.id === selectedSlotId) ?? null,
    [selectedSlotId, tutor?.slots],
  );

  // Initialize subject/date when a different tutor is loaded.
  useEffect(() => {
    if (!tutor) {
      return;
    }
    setSubject((current) =>
      current && (tutor.subjects ?? []).includes(current) ? current : tutor.subjects?.[0] ?? '',
    );
    const withSlots = weekDates.find((date) => (grouped[date]?.length ?? 0) > 0);
    const initialSlot = initialSlotId
      ? (tutor.slots ?? []).find((slot) => slot.id === initialSlotId)
      : null;
    setSelectedDate(initialSlot?.date ?? withSlots ?? localDate());
    if (initialSlot) {
      setSelectedSlotId(initialSlot.id);
      setCustomMode(false);
    }
    // Reset when the tutor identity changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor?.id]);

  // A new schedule selection is a new booking intent, so rotate the token.
  useEffect(() => {
    tokenRef.current = makeClientToken();
  }, [selectedSlotId, customMode, customDate, customTime, mode, subject]);

  function chooseCustom(next: boolean) {
    setCustomMode(next);
    setFormError(null);
    if (next) {
      setSelectedSlotId('');
    }
  }

  function changeTutor(nextTutorId: string) {
    setTutorId(nextTutorId);
    setSelectedSlotId('');
    setCustomMode(false);
    setTopic('');
    setNotes('');
    setFormError(null);
  }

  const activeLocation =
    customMode && mode === 'Offline'
      ? location.trim()
      : selectedSlot?.mode === 'Offline'
        ? selectedSlot.location
        : '';

  const activeMode: BookingMode = customMode ? mode : selectedSlot?.mode ?? 'Online';
  const activeTime = customMode ? customTime : selectedSlot?.time ?? '';
  const activeDate = customMode ? customDate : selectedSlot?.date ?? selectedDate;

  function validate(): string | null {
    if (!tutor) {
      return 'Choose a tutor first.';
    }
    if (!isStudent) {
      return 'Only student accounts can create bookings.';
    }
    if (!subject) {
      return 'Choose a subject.';
    }
    if (!topic.trim()) {
      return 'Tell the tutor what you want help with.';
    }
    if (customMode) {
      if (!isValidDate(customDate)) {
        return 'Use a valid date in YYYY-MM-DD format.';
      }
      if (!customTime) {
        return 'Choose a preferred time.';
      }
      if (mode === 'Offline' && !location.trim()) {
        return 'Add a meeting location for an offline request.';
      }
    } else if (!selectedSlot) {
      return 'Choose one of the available slots.';
    } else if (selectedSlot.reserved) {
      return 'That slot is already reserved. Pick another time.';
    }
    return null;
  }

  function handleSubmit() {
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setReviewOpen(true);
  }

  async function sendRequest() {
    setReviewOpen(false);
    setSubmitting(true);
    try {
      const base = {
        subject,
        topic: topic.trim(),
        notes: notes.trim(),
        client_token: tokenRef.current,
      };
      const booking = customMode
        ? await createBooking({
            ...base,
            tutor: tutor!.id,
            date: customDate,
            time: customTime,
            mode,
            location: mode === 'Offline' ? location.trim() : '',
            custom: true,
          })
        : await createBooking({
            ...base,
            slot_id: selectedSlot!.id,
          });
      setSuccess(booking);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Could not send the booking request.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother() {
    setSuccess(null);
    setTopic('');
    setNotes('');
    setSelectedSlotId('');
    setCustomTime('');
    setLocation('');
    setFormError(null);
    tokenRef.current = makeClientToken();
  }

  if (success) {
    return (
      <Screen>
        <ScreenHeader title="Request sent" onBack={() => router.back()} homeLink />
        <Card tone="success" style={{ gap: spacing.md }}>
          <View style={successHeadStyles}>
            <View style={successMarkStyles}>
              <Ionicons name="checkmark" size={26} color={colors.surface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={successTitleStyles}>You're on the tutor's radar.</Text>
              <Text style={successBodyStyles}>
                Your request is pending. The tutor can confirm it or suggest another time.
              </Text>
            </View>
          </View>
          <KeyValue label="Subject" value={success.subject} strong />
          <KeyValue label="When" value={`${formatDate(success.date)} at ${success.time}`} strong />
          <KeyValue label="Mode" value={success.mode} />
          {success.location ? <KeyValue label="Location" value={success.location} /> : null}
          <KeyValue label="Status" value={success.display_status || success.status} />
        </Card>
        <PrimaryButton
          label="View my requests"
          onPress={() => router.replace('/(tabs)/requests')}
        />
        <View style={{ gap: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(tabs)/dashboard')}
            style={({ pressed }) => [secondaryWideStyles, pressed ? { opacity: 0.8 } : null]}
          >
            <Text style={secondaryWideTextStyles}>Back to dashboard</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={startAnother}
            style={({ pressed }) => [secondaryWideStyles, pressed ? { opacity: 0.8 } : null]}
          >
            <Text style={secondaryWideTextStyles}>Book another session</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (loading && !data) {
    return (
      <Screen>
        <ScreenHeader title="Book a session" onBack={() => router.back()} homeLink />
        <LoadingState label="Loading booking options..." />
      </Screen>
    );
  }

  if (error && !data) {
    return (
      <Screen>
        <ScreenHeader title="Book a session" onBack={() => router.back()} homeLink />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  if (!tutor) {
    return (
      <Screen>
        <ScreenHeader title="Book a session" onBack={() => router.back()} homeLink />
        <EmptyState
          icon="people-outline"
          title="No tutors available yet."
          body="A tutor needs to register before a session can be requested."
          action={<PrimaryButton label="Back to find tutors" onPress={() => router.replace('/(tabs)/find')} />}
        />
      </Screen>
    );
  }

  const tutorName = tutor.full_name?.trim() || tutor.username;
  const tutorOptions = (data?.tutors ?? []).map((item) => ({
    value: item.id,
    label: item.full_name?.trim() || item.username,
    description: (item.subjects ?? []).slice(0, 3).join(', '),
  }));

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow="Booking"
        title={`Request a session with ${tutorName}`}
        subtitle="Pick a published slot or ask for a custom time, then describe what you need help with."
        onBack={() => router.back()}
        homeLink
      />

      {!isStudent ? (
        <InlineMessage tone="warning">
          Only student accounts can create bookings. Switch to a student account to request a
          session.
        </InlineMessage>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="Tutor and subject" subtitle="Start with the person who can help." />
        {!initialTutorId ? (
          <SelectField
            label="Tutor"
            value={tutor.id}
            options={tutorOptions}
            onSelect={changeTutor}
            searchable
          />
        ) : null}
        <SelectField
          label="Subject"
          value={subject}
          options={(tutor.subjects ?? []).map((item) => ({ value: item, label: item }))}
          onSelect={setSubject}
          placeholder="Choose a subject"
        />
        <View style={miniProfileStyles}>
          <Avatar name={tutorName} accent={tutor.accent || colors.primary} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={miniNameStyles}>{tutorName}</Text>
            <Text style={miniMetaStyles}>
              {tutor.rating ? `${tutor.rating.toFixed(1)} rating` : 'New tutor'} -{' '}
              {tutor.sessions_count} sessions
            </Text>
          </View>
          <Badge
            label={`${tutor.open_slots_next_7d} open`}
            tone={tutor.open_slots_next_7d ? 'success' : 'neutral'}
          />
        </View>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="Schedule" subtitle="Use a visible slot or ask for another time." />
        <View style={choiceRowStyles}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !customMode }}
            onPress={() => chooseCustom(false)}
            style={({ pressed }) => [
              choiceStyles,
              !customMode ? choiceSelectedStyles : null,
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={!customMode ? choiceTitleSelectedStyles : choiceTitleStyles}>
              Available slot
            </Text>
            <Text style={choiceBodyStyles}>Pick what the tutor published.</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: customMode }}
            onPress={() => chooseCustom(true)}
            style={({ pressed }) => [
              choiceStyles,
              customMode ? choiceSelectedStyles : null,
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={customMode ? choiceTitleSelectedStyles : choiceTitleStyles}>
              Custom time
            </Text>
            <Text style={choiceBodyStyles}>Ask the tutor to fit you in.</Text>
          </Pressable>
        </View>

        {!customMode ? (
          <View style={{ gap: spacing.md }}>
            <DateStrip
              dates={weekDates}
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                setSelectedSlotId('');
              }}
              counts={slotCounts}
            />
            {dateSlots.length === 0 ? (
              <EmptyState
                icon="calendar-clear-outline"
                title="No slots on this day"
                body="Choose another day or switch to a custom time request."
              />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {dateSlots.map((slot) => {
                  const chosen = slot.id === selectedSlotId;
                  return (
                    <Pressable
                      key={slot.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen, disabled: slot.reserved }}
                      disabled={slot.reserved}
                      onPress={() => setSelectedSlotId(slot.id)}
                      style={({ pressed }) => [
                        slotStyles,
                        chosen ? slotSelectedStyles : null,
                        slot.reserved ? { opacity: 0.5 } : null,
                        pressed ? { opacity: 0.8 } : null,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={slotTimeStyles}>{slot.time}</Text>
                        <Text style={slotMetaStyles}>
                          {slot.mode}
                          {slot.mode === 'Offline' && slot.location ? ` - ${slot.location}` : ''}
                        </Text>
                        <Text style={slotMetaStyles}>{slot.duration} minutes</Text>
                      </View>
                      {slot.reserved ? (
                        <Badge label="Reserved" tone="danger" />
                      ) : chosen ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                      ) : (
                        <Ionicons name="ellipse-outline" size={22} color={colors.faint} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <DateStrip dates={nextDates(14)} selected={customDate} onSelect={setCustomDate} />
            <LabeledInput
              label="Date (YYYY-MM-DD)"
              value={customDate}
              onChangeText={setCustomDate}
              placeholder="2026-11-20"
              autoCapitalize="none"
              hint="The tutor can accept, decline, or suggest another time."
            />
            <View style={{ gap: spacing.sm }}>
              <Text style={fieldLabelStyles}>Preferred time</Text>
              <View style={chipRowStyles}>
                {TIME_CHOICES.map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={customTime === time}
                    onPress={() => setCustomTime(time)}
                  />
                ))}
              </View>
            </View>
            <View style={{ gap: spacing.sm }}>
              <Text style={fieldLabelStyles}>Session mode</Text>
              <View style={chipRowStyles}>
                {(['Online', 'Offline'] as BookingMode[]).map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={mode === option}
                    onPress={() => {
                      setMode(option);
                      if (option === 'Online') {
                        setLocation('');
                      }
                    }}
                  />
                ))}
              </View>
            </View>
            {mode === 'Offline' ? (
              <LabeledInput
                label="Meeting location"
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Library study zone, 2nd floor"
              />
            ) : null}
            <InlineMessage tone="info">
              The request stays pending until the tutor accepts your preferred time.
            </InlineMessage>
          </View>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="What do you need help with?" subtitle="A little context helps the tutor prepare." />
        <LabeledTextArea
          label="Topic"
          value={topic}
          onChangeText={setTopic}
          placeholder="e.g. I can calculate eigenvalues but do not understand what they mean visually."
        />
        <LabeledTextArea
          label="Additional notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything else the tutor should know?"
          minHeight={70}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionHeading title="Live summary" />
        <KeyValue label="Tutor" value={tutorName} />
        <KeyValue label="Subject" value={subject || 'Choose a subject'} strong />
        <KeyValue
          label="When"
          value={activeDate ? `${formatDate(activeDate)}${activeTime ? ` at ${activeTime}` : ''}` : 'Choose a time'}
        />
        <KeyValue label="Mode" value={activeMode} />
        <KeyValue label="Type" value={customMode ? 'Custom request' : 'Published slot'} />
        {activeLocation ? <KeyValue label="Location" value={activeLocation} /> : null}
      </Card>

      {formError ? <InlineMessage tone="danger">{formError}</InlineMessage> : null}

      <PrimaryButton
        label={submitting ? 'Sending request...' : 'Submit request'}
        loading={submitting}
        disabled={!isStudent}
        onPress={handleSubmit}
      />

      <ConfirmModal
        visible={reviewOpen}
        title="Send this request?"
        message={
          activeDate
            ? `${subject} on ${formatDate(activeDate)}${
                activeTime ? ` at ${activeTime}` : ''
              } with ${tutorName} - ${activeMode}. It will appear as Pending until the tutor responds.`
            : undefined
        }
        confirmLabel="Send request"
        loading={submitting}
        onConfirm={sendRequest}
        onCancel={() => setReviewOpen(false)}
      />
    </Screen>
  );
}

const successHeadStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: spacing.md,
};

const successMarkStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primary,
  borderRadius: 24,
  height: 48,
  justifyContent: 'center' as const,
  width: 48,
};

const successTitleStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 18,
  fontWeight: '600' as const,
};

const successBodyStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 19,
  marginTop: 2,
};

const secondaryWideStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.button,
  borderWidth: 1,
  justifyContent: 'center' as const,
  minHeight: 44,
};

const secondaryWideTextStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700' as const,
};

const miniProfileStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderRadius: radii.md,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.sm,
};

const miniNameStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700' as const,
};

const miniMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
};

const choiceRowStyles = {
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const choiceStyles = {
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.md,
  borderWidth: 1,
  flex: 1,
  gap: 2,
  padding: spacing.sm,
};

const choiceSelectedStyles = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const choiceTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const choiceTitleSelectedStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const choiceBodyStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 15,
};

const slotStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.sm,
  ...shadows.card,
};

const slotSelectedStyles = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const slotTimeStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600' as const,
};

const slotMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  marginTop: 1,
};

const fieldLabelStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600' as const,
};

const chipRowStyles = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: 6,
};
