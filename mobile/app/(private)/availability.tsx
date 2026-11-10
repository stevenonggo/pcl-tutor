import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DateStrip } from '@/components/DateStrip';
import { LabeledInput } from '@/components/LabeledInput';
import {
  Badge,
  Card,
  Chip,
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
import {
  ApiError,
  createAvailabilitySlot,
  deleteAvailabilitySlot,
  listAvailability,
} from '@/lib/api';
import { DURATION_CHOICES, TIME_CHOICES } from '@/lib/booking';
import { formatDate, isValidDate, localDate, nextDates } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { AvailabilitySlot, BookingMode } from '@/lib/types';
import { colors, fonts, radii, spacing } from '@/theme';

interface AvailabilityData {
  date: string;
  slots: AvailabilitySlot[];
}

export default function AvailabilityScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const isTutor = profile?.role === 'tutor';

  const [selectedDate, setSelectedDate] = useState(localDate());
  const [time, setTime] = useState<string>('09:00');
  const [duration, setDuration] = useState<number>(60);
  const [mode, setMode] = useState<BookingMode>('Online');
  const [location, setLocation] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [slotToDelete, setSlotToDelete] = useState<AvailabilitySlot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<AvailabilityData>(
    async () => {
      const slots = await listAvailability(selectedDate);
      return { date: selectedDate, slots };
    },
    [selectedDate],
    { refreshOnFocus: true },
  );

  const slots = data?.date === selectedDate ? data.slots : [];

  async function handlePublish() {
    if (!isValidDate(selectedDate)) {
      setFormError('Use a valid date in YYYY-MM-DD format.');
      return;
    }
    if (mode === 'Offline' && !location.trim()) {
      setFormError('Add a meeting room for an in-person slot.');
      return;
    }
    setPublishing(true);
    setFormError(null);
    setFeedback(null);
    try {
      await createAvailabilitySlot({
        date: selectedDate,
        time,
        mode,
        location: mode === 'Offline' ? location.trim() : '',
        duration,
      });
      setFeedback(
        `Published ${time} - ${mode} on ${formatDate(selectedDate)}. Students can now book it.`,
      );
      setLocation('');
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not publish the slot.');
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!slotToDelete) {
      return;
    }
    setDeleting(true);
    setFormError(null);
    setFeedback(null);
    try {
      await deleteAvailabilitySlot(slotToDelete.id);
      setFeedback(`Removed the ${slotToDelete.time} slot on ${formatDate(slotToDelete.date)}.`);
      setSlotToDelete(null);
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not delete the slot.');
      setSlotToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!isTutor) {
    return (
      <Screen>
        <ScreenHeader
          eyebrow="Tutor tools"
          title="Availability"
          subtitle="Availability management is tutor-only."
          onBack={() => router.back()}
          homeLink
        />
        <EmptyState
          icon="lock-closed-outline"
          title="Switch to a tutor account"
          body="Students book tutors from a profile. Become a tutor from your profile to publish open hours."
          action={
            <PrimaryButton label="Open profile" onPress={() => router.push('/(tabs)/me')} />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow="Tutor tools"
        title="Your availability"
        subtitle="Publish the hours you are ready to teach. Students see these slots on your profile."
        onBack={() => router.back()}
        homeLink
      />

      {feedback ? <InlineMessage tone="success">{feedback}</InlineMessage> : null}

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="Choose a day" subtitle="Slots are managed one day at a time." />
        <DateStrip dates={nextDates(14)} selected={selectedDate} onSelect={setSelectedDate} />
        <LabeledInput
          label="Date (YYYY-MM-DD)"
          value={selectedDate}
          onChangeText={setSelectedDate}
          placeholder="2026-11-20"
          autoCapitalize="none"
          hint="The backend stores dates as YYYY-MM-DD."
        />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading title="Add a slot" subtitle="Open another hour for students." />
        <View style={{ gap: spacing.sm }}>
          <Text style={fieldLabelStyles}>Start time</Text>
          <View style={chipRowStyles}>
            {TIME_CHOICES.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={time === option}
                onPress={() => setTime(option)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={fieldLabelStyles}>Duration</Text>
          <View style={chipRowStyles}>
            {DURATION_CHOICES.map((option) => (
              <Chip
                key={option}
                label={`${option} min`}
                selected={duration === option}
                onPress={() => setDuration(option)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={fieldLabelStyles}>Format</Text>
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
            label="Meeting room"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Library study zone, 2nd floor"
          />
        ) : null}

        {formError ? <InlineMessage tone="danger">{formError}</InlineMessage> : null}

        <PrimaryButton
          label={publishing ? 'Publishing...' : 'Publish availability'}
          loading={publishing}
          onPress={handlePublish}
        />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeading
          title={formatDate(selectedDate)}
          subtitle={`${slots.length} published slot${slots.length === 1 ? '' : 's'}.`}
        />
        {loading && data?.date !== selectedDate ? (
          <LoadingState label="Loading slots..." />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : slots.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="No slots on this day"
            body="Publish an open hour above and it will appear here immediately."
          />
        ) : (
          slots.map((slot) => (
            <View key={slot.id} style={slotStyles}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={slotHeadStyles}>
                  <Text style={slotTimeStyles}>{slot.time}</Text>
                  <Badge label={slot.mode} tone={slot.mode === 'Online' ? 'success' : 'warning'} />
                  {slot.reserved ? <Badge label="Reserved" tone="danger" /> : null}
                </View>
                <Text style={slotMetaStyles}>
                  {slot.duration} minutes
                  {slot.mode === 'Offline' && slot.location ? ` - ${slot.location}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: slot.reserved }}
                disabled={slot.reserved}
                onPress={() => setSlotToDelete(slot)}
                style={({ pressed }) => [
                  deleteButtonStyles,
                  slot.reserved ? { opacity: 0.4 } : null,
                  pressed ? { opacity: 0.75 } : null,
                ]}
              >
                <Ionicons name="trash-outline" size={17} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
        {slots.some((slot) => slot.reserved) ? (
          <Text style={hintStyles}>
            Reserved slots are held by a pending or confirmed booking and cannot be removed here.
          </Text>
        ) : null}
      </Card>

      <Card>
        <SectionHeading title="How students see this" />
        <KeyValue label="Visible on profile" value="Open slots for the next 7 days" />
        <KeyValue label="Booked by" value="Students, one active request per slot" />
        <KeyValue label="Reserved slot" value="Hidden from new bookings" />
      </Card>

      <ConfirmModal
        visible={Boolean(slotToDelete)}
        title="Delete this slot?"
        message={
          slotToDelete
            ? `Remove the ${slotToDelete.time} ${slotToDelete.mode} slot on ${formatDate(
                slotToDelete.date,
              )}? Students will no longer be able to book it.`
            : undefined
        }
        confirmLabel="Delete slot"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setSlotToDelete(null)}
      />
    </Screen>
  );
}

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

const slotStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.sm,
};

const slotHeadStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: 6,
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
};

const deleteButtonStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.dangerSoft,
  borderColor: colors.danger,
  borderRadius: radii.sm,
  borderWidth: 1,
  height: 36,
  justifyContent: 'center' as const,
  width: 36,
};

const hintStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 16,
};
