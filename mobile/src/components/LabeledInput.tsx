import { type ComponentProps } from 'react';
import {
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fonts, radii, shadows } from '@/theme';

interface LabeledInputBase {
  label: string;
  /** Helper text shown below the input when there is no error. */
  hint?: string;
  /** Validation/error message shown below the input; overrides `hint`. */
  error?: string;
  /** Outer container style. */
  containerStyle?: StyleProp<ViewStyle | TextStyle>;
}

/**
 * Labeled text input — mirrors the web app's .input-shell: 46px minimum
 * height, 9px radius, 1px line border, white surface, 15px Inter body text
 * with muted labels and placeholders.
 *
 * Spreads all standard TextInput props (value, onChangeText, ...).
 */
type LabeledInputProps = LabeledInputBase &
  Omit<ComponentProps<typeof TextInput>, 'style'> & {
    style?: StyleProp<ViewStyle | TextStyle>;
  };

export function LabeledInput({ label, hint, error, containerStyle, style, ...inputProps }: LabeledInputProps) {
  return (
    <View style={{ gap: 7, ...containerStyle }}>
      <Text style={labelStyles}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        style={[inputStyles, error ? { borderColor: colors.danger } : null, style]}
        {...inputProps}
      />
      {error ? (
        <Text style={errorStyles}>{error}</Text>
      ) : hint ? (
        <Text style={hintStyles}>{hint}</Text>
      ) : null}
    </View>
  );
}

const labelStyles: TextStyle = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600',
};

const inputStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 15,
  minHeight: 46,
  paddingHorizontal: 13,
  ...shadows.card,
};

const hintStyles: TextStyle = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 12,
};

const errorStyles: TextStyle = {
  color: colors.danger,
  fontFamily: fonts.body,
  fontSize: 12,
};
