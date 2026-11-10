import { ActivityIndicator, Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  /** While true the button is disabled and shows a spinner instead of the label. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle | TextStyle>;
}

/**
 * Primary call-to-action button — mirrors the web app's .primary-button:
 * accent fill, 44px minimum height, 10px radius, semibold white label and
 * a soft accent shadow.
 */
export function PrimaryButton({ label, onPress, loading, disabled, style }: PrimaryButtonProps) {
  const blocked = Boolean(disabled) || Boolean(loading);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        buttonStyles,
        blocked ? { opacity: 0.55 } : null,
        pressed && !blocked ? { transform: [{ scale: 0.98 }] } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.surface} />
      ) : (
        <Text style={labelStyles}>{label}</Text>
      )}
    </Pressable>
  );
}

const buttonStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.primary,
  borderRadius: radii.button,
  justifyContent: 'center',
  minHeight: 44,
  paddingHorizontal: spacing.lg,
  ...shadows.accent,
};

const labelStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.surface,
  fontFamily: fonts.body,
  fontSize: 16,
  fontWeight: '600',
};
