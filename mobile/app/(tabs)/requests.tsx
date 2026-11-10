import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
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
import { ApiError, listRequests, sessionAction } from '@/lib/api';
import { isActiveStatus, statusLabel, statusTone, TIME_CHOICES } from '@/lib/booking';
import { formatDate, isValidDate } from '@/lib/datetime';
import { useAuth } from '@/stores/AuthProvider';
import type { Booking, BookingActionPayload } from '@/lib/types';
import { colors, fonts, radii, spacing } from '@/theme';

interface ConfirmState {
  booking: Booking;
  action: 'decline' | 'cancel';
}

export default function RequestsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const isTutor = profile?.role === 'tutor';

  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<Booking[]>(
    () => listRequests(),
    [],
    { refreshOnFocus: true },
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [suggestFor, setSuggestFor] = useState<Booking | null>(null);

  const requests = data ?? [];
  const active = useMemo(() => requests.filter((item) => isActiveStatus(item.status)), [requests]);
  const decided = useMemo(() => requests.filter((item) => !isActiveStatus(item.status)), [requests]);

  async function runAction(
    booking: Booking,
    payload: BookingActionPayload,
    successMessage: string,
  ): Promise<void> {
    setBusyId(booking.id);
    setFeedback(null);
    setActionError(null);
    try {
      await sessionAction(booking.id, payload);
      await refresh();
      setFeedback(successMessage);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not update the request.';
      setActionError(message);
      throw err;
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirm(booking: Booking) {
    try {
      if (isTutor) {
        await runAction(booking, { action: 'confirm' }, 'Request confirmed. It is now a session.');
      } else {
        await runAction(
          booking,
          { action: 'confirm' },
          'Suggested time accepted. The session is confirmed.',
        );
      }
    } catch {
      // Error is surfaced through actionError.
    }
  }

  async function handleDestructive() {
    if (!confirm) {
      return;
    }
    const { booking, action } = confirm;
    try {
      await runAction(
        booking,
        { action },
        action === 'decline'
          ? 'Request declined. The student can see the decision.'
          : 'Request cancelled.',
      );
    } catch {
      // Error is surfaced through actionError.
    } finally {
      setConfirm(null);
    }
  }

  async function handleSuggest(payload: {
    date: string;
    time: string;
    alternative: string;
    suggestion: string;
  }) {
    if (!suggestFor) {
      return;
    }
    await runAction(
      suggestFor,
      {
        action: 'suggest',
        date: payload.date,
        time: payload.time,
        alternative: payload.alternative,
        suggestion: payload.suggestion,
      },
      'Suggestion sent. The request stays pending until the student accepts.',
    );
    setSuggestFor(null);
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow={isTutor ? 'Incoming requests' : 'My requests'}
        title={isTutor ? 'Decide with context' : 'Keep requests easy to follow'}
        subtitle={
          isTutor
            ? 'Open one request, understand the student need, then confirm, suggest, or decline.'
            : 'Pending requests stay here until your tutor confirms or proposes another time.'
        }
        right={
          !isTutor ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/find')}
              style={({ pressed }) => [newButtonStyles, pressed ? { opacity: 0.85 } : null]}
            >
              <Ionicons name="add" size={16} color={colors.surface} />
              <Text style={newButtonTextStyles}>New</Text>
            </Pressable>
          ) : undefined
        }
        homeLink
      />

      {feedback ? <InlineMessage tone="success">{feedback}</InlineMessage> : null}
      {actionError ? <InlineMessage tone="danger">{actionError}</InlineMessage> : null}

      {loading && !data ? <LoadingState label="Loading requests..." /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {!loading || data ? (
        <Card style={{ gap: spacing.md }}>
          <SectionHeading
            title="Needs attention"
            subtitle={
              active.length
                ? `${active.length} request${active.length === 1 ? '' : 's'} in progress.`
                : 'Nothing needs a decision right now.'
            }
            right={<Badge label={String(active.length)} tone={active.length ? 'warning' : 'success'} />}
          />

          {active.length === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title="No requests need a decision."
              body={
                isTutor
                  ? 'New student requests will appear here.'
                  : 'Your pending requests will appear here.'
              }
            />
          ) : (
            <View style={{ gap: spacing.md }}>
              {active.map((booking) => (
                <RequestCard
                  key={booking.id}
                  booking={booking}
                  isTutor={isTutor}
                  busy={busyId === booking.id}
                  onConfirm={() => handleConfirm(booking)}
                  onSuggest={() => setSuggestFor(booking)}
                  onDestructive={() =>
                    setConfirm({
                      booking,
                      action: isTutor ? 'decline' : 'cancel',
                    })
                  }
                />
              ))}
            </View>
          )}
        </Card>
      ) : null}

      {decided.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeading title="Past decisions" subtitle="Cancelled and rejected requests." />
          {decided.map((booking) => (
            <View key={booking.id} style={historyRowStyles}>
              <View style={{ flex: 1 }}>
                <Text style={historyTitleStyles}>
                  {isTutor ? booking.student_name || 'Student' : booking.subject}
                </Text>
                <Text style={historyBodyStyles} numberOfLines={1}>
                  {booking.topic || booking.subject} - {formatDate(booking.date)} at {booking.time}
                </Text>
              </View>
              <Badge
                label={statusLabel(booking.status, booking.display_status)}
                tone={statusTone(booking.status, booking.display_status)}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <ConfirmModal
        visible={Boolean(confirm)}
        title={confirm?.action === 'decline' ? 'Decline this request?' : 'Cancel this request?'}
        message={
          confirm
            ? `${confirm.booking.subject} on ${formatDate(confirm.booking.date)} at ${
                confirm.booking.time
              } with ${
                confirm.action === 'decline'
                  ? confirm.booking.student_name || 'the student'
                  : confirm.booking.tutor_name || 'the tutor'
              }. This cannot be undone from either side.`
            : undefined
        }
        confirmLabel={confirm?.action === 'decline' ? 'Decline request' : 'Cancel request'}
        tone="danger"
        loading={Boolean(confirm && busyId === confirm.booking.id)}
        onConfirm={handleDestructive}
        onCancel={() => setConfirm(null)}
      />

      <SuggestModal
        booking={suggestFor}
        saving={Boolean(suggestFor && busyId === suggestFor.id)}
        onClose={() => setSuggestFor(null)}
        onSubmit={handleSuggest}
      />
    </Screen>
  );
}

function RequestCard({
  booking,
  isTutor,
  busy,
  onConfirm,
  onSuggest,
  onDestructive,
}: {
  booking: Booking;
  isTutor: boolean;
  busy: boolean;
  onConfirm: () => void;
  onSuggest: () => void;
  onDestructive: () => void;
}) {
  const title = isTutor ? booking.student_name || 'Student' : booking.subject;
  const proposed = booking.status === 'Suggested';
  const personName = isTutor ? booking.student_name : booking.tutor_name;
  return (
    <View style={requestCardStyles}>
      <View style={requestHeadStyles}>
        <Avatar
          name={title}
          accent={isTutor ? '#3568C8' : colors.primary}
          size={44}
        />
        <View style={{ flex: 1 }}>
          <Text style={requestEyebrowStyles}>{proposed ? 'Tutor suggested' : 'Request'}</Text>
          <Text style={requestTitleStyles}>{title}</Text>
          <Text style={requestTopicStyles}>{booking.topic || booking.subject}</Text>
        </View>
        <Badge
          label={statusLabel(booking.status, booking.display_status)}
          tone={statusTone(booking.status, booking.display_status)}
        />
      </View>

      <View style={{ gap: 4 }}>
        <KeyValue
          label={proposed ? 'Proposed' : 'When'}
          value={
            proposed && booking.suggested_date
              ? `${formatDate(booking.suggested_date)} at ${booking.suggested_time}`
              : `${formatDate(booking.date)} at ${booking.time}`
          }
          strong
        />
        <KeyValue
          label="Mode"
          value={
            booking.mode === 'Offline' && booking.location
              ? `Offline - ${booking.location}`
              : booking.mode
          }
        />
        {!isTutor && personName ? <KeyValue label="Tutor" value={personName} /> : null}
        {isTutor ? <KeyValue label="Subject" value={booking.subject} /> : null}
      </View>

      {booking.notes ? (
        <View style={noteBoxStyles}>
          <Text style={noteTextStyles}>{booking.notes}</Text>
        </View>
      ) : null}

      {proposed ? (
        <View style={suggestionBoxStyles}>
          <Ionicons name="calendar-outline" size={15} color={colors.primaryDark} />
          <View style={{ flex: 1 }}>
            <Text style={suggestionTitleStyles}>Tutor proposed a new time</Text>
            <Text style={suggestionBodyStyles}>
              {booking.suggestion || 'Review the proposed schedule before accepting.'}
            </Text>
            {booking.alternative ? (
              <Text style={suggestionBodyStyles}>Backup: {booking.alternative}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={actionRowStyles}>
        {isTutor && booking.status === 'Pending' ? (
          <>
            <PrimaryButton
              label="Accept"
              onPress={onConfirm}
              loading={busy}
              style={{ flex: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onSuggest}
                style={({ pressed }) => [outlineButtonStyles, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={outlineButtonTextStyles}>Suggest time</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onDestructive}
                style={({ pressed }) => [dangerButtonStyles, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={dangerButtonTextStyles}>Decline</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {!isTutor && booking.status === 'Suggested' ? (
          <>
            <PrimaryButton
              label="Accept new time"
              onPress={onConfirm}
              loading={busy}
              style={{ flex: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onDestructive}
                style={({ pressed }) => [dangerButtonStyles, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={dangerButtonTextStyles}>Cancel</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {!isTutor && booking.status === 'Pending' ? (
          <Badge label="Waiting for tutor" tone="warning" />
        ) : null}

        {isTutor && booking.status === 'Suggested' ? (
          <Badge label="Waiting for student" tone="info" />
        ) : null}
      </View>
    </View>
  );
}

function SuggestModal({
  booking,
  saving,
  onClose,
  onSubmit,
}: {
  booking: Booking | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    date: string;
    time: string;
    alternative: string;
    suggestion: string;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [alternative, setAlternative] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (booking) {
      setDate(booking.suggested_date || booking.date);
      setTime(booking.suggested_time || booking.time);
      setAlternative(booking.alternative || '');
      setMessage(booking.suggestion || '');
      setError(null);
    }
  }, [booking]);

  if (!booking) {
    return null;
  }

  async function submit() {
    if (!isValidDate(date)) {
      setError('Use a valid date in YYYY-MM-DD format.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError('Choose a time.');
      return;
    }
    setError(null);
    try {
      await onSubmit({ date, time, alternative, suggestion: message.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the suggestion.');
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={modalContentStyles} keyboardShouldPersistTaps="handled">
          <View style={modalHeaderStyles}>
            <View style={{ flex: 1 }}>
              <Text style={modalEyebrowStyles}>Tutor response</Text>
              <Text style={modalTitleStyles}>Suggest another time</Text>
              <Text style={modalSubtitleStyles}>
                {booking.student_name || 'Student'} - {booking.subject}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={closeButtonStyles}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Card style={{ gap: spacing.md }}>
            <KeyValue
              label="Original"
              value={`${formatDate(booking.date)} at ${booking.time}`}
              strong
            />
            <KeyValue label="Topic" value={booking.topic || booking.subject} />
            <LabeledInput
              label="New date (YYYY-MM-DD)"
              value={date}
              onChangeText={setDate}
              placeholder="2026-11-20"
              autoCapitalize="none"
            />
            <View style={{ gap: spacing.sm }}>
              <Text style={modalFieldLabelStyles}>New time</Text>
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
            <LabeledInput
              label="Alternative time (optional)"
              value={alternative}
              onChangeText={setAlternative}
              placeholder="e.g. 18:00"
              autoCapitalize="none"
            />
            <LabeledTextArea
              label="Message"
              value={message}
              onChangeText={setMessage}
              placeholder="Explain briefly why the new time works better."
              minHeight={80}
            />
            {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
            <PrimaryButton
              label={saving ? 'Sending suggestion...' : 'Send suggestion'}
              loading={saving}
              onPress={submit}
            />
            <Text style={modalHintStyles}>
              Nothing is confirmed yet. The request stays pending until the student accepts.
            </Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const newButtonStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primary,
  borderRadius: radii.button,
  flexDirection: 'row' as const,
  gap: 4,
  minHeight: 38,
  paddingHorizontal: 12,
};

const newButtonTextStyles = {
  color: colors.surface,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const requestCardStyles = {
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  gap: spacing.sm,
  padding: spacing.md,
};

const requestHeadStyles = {
  alignItems: 'flex-start' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const requestEyebrowStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '700' as const,
  letterSpacing: 1,
  textTransform: 'uppercase' as const,
};

const requestTitleStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600' as const,
};

const requestTopicStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  marginTop: 1,
};

const noteBoxStyles = {
  backgroundColor: colors.surface,
  borderRadius: radii.sm,
  padding: spacing.sm,
};

const noteTextStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  lineHeight: 17,
};

const suggestionBoxStyles = {
  alignItems: 'flex-start' as const,
  backgroundColor: colors.primarySoft,
  borderRadius: radii.sm,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  padding: spacing.sm,
};

const suggestionTitleStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '700' as const,
};

const suggestionBodyStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 1,
};

const actionRowStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: spacing.sm,
};

const outlineButtonStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.button,
  borderWidth: 1,
  justifyContent: 'center' as const,
  minHeight: 44,
  paddingHorizontal: spacing.sm,
};

const outlineButtonTextStyles = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const dangerButtonStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.dangerSoft,
  borderColor: colors.danger,
  borderRadius: radii.button,
  borderWidth: 1,
  justifyContent: 'center' as const,
  minHeight: 44,
  paddingHorizontal: spacing.sm,
};

const dangerButtonTextStyles = {
  color: colors.danger,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const historyRowStyles = {
  alignItems: 'center' as const,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  paddingTop: spacing.sm,
};

const historyTitleStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700' as const,
};

const historyBodyStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  marginTop: 1,
};

const modalContentStyles = {
  gap: spacing.md,
  padding: spacing.lg,
  paddingBottom: spacing.xl,
};

const modalHeaderStyles = {
  alignItems: 'flex-start' as const,
  flexDirection: 'row' as const,
  gap: spacing.sm,
};

const modalEyebrowStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 1.3,
  textTransform: 'uppercase' as const,
};

const modalTitleStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 22,
  fontWeight: '600' as const,
  letterSpacing: -0.5,
};

const modalSubtitleStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  marginTop: 2,
};

const closeButtonStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  height: 38,
  justifyContent: 'center' as const,
  width: 38,
};

const modalFieldLabelStyles = {
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

const modalHintStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  lineHeight: 16,
  textAlign: 'center' as const,
};
