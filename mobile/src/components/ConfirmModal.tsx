import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native-looking confirmation sheet for destructive booking/availability actions. */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const danger = tone === 'danger';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={backdropStyles}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
          disabled={loading}
          onPress={onCancel}
          style={{ flex: 1 }}
        />
        <View style={cardStyles}>
          <Text style={titleStyles}>{title}</Text>
          {message ? <Text style={messageStyles}>{message}</Text> : null}
          <View style={actionRowStyles}>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={onCancel}
              style={({ pressed }) => [cancelStyles, pressed ? { opacity: 0.75 } : null]}
            >
              <Text style={cancelTextStyles}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              disabled={loading}
              onPress={onConfirm}
              style={({ pressed }) => [
                confirmStyles,
                danger ? dangerConfirmStyles : null,
                loading ? { opacity: 0.6 } : null,
                pressed && !loading ? { opacity: 0.85 } : null,
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={confirmTextStyles}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
          disabled={loading}
          onPress={onCancel}
          style={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}

const backdropStyles = {
  backgroundColor: 'rgba(18, 21, 26, 0.45)',
  flex: 1,
  justifyContent: 'center' as const,
  padding: spacing.lg,
};

const cardStyles = {
  backgroundColor: colors.surface,
  borderRadius: radii.lg,
  gap: spacing.sm,
  padding: spacing.lg,
};

const titleStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 19,
  fontWeight: '600' as const,
  letterSpacing: -0.4,
};

const messageStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 14,
  lineHeight: 20,
};

const actionRowStyles = {
  flexDirection: 'row' as const,
  gap: spacing.sm,
  marginTop: spacing.sm,
};

const cancelStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.button,
  borderWidth: 1,
  flex: 1,
  justifyContent: 'center' as const,
  minHeight: 44,
};

const cancelTextStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700' as const,
};

const confirmStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.primary,
  borderRadius: radii.button,
  flex: 1,
  justifyContent: 'center' as const,
  minHeight: 44,
};

const dangerConfirmStyles = {
  backgroundColor: colors.danger,
};

const confirmTextStyles = {
  color: colors.surface,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700' as const,
};
