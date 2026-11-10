import { type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Tone } from '@/lib/booking';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const TONES: Record<Tone, { background: string; border: string; text: string }> = {
  neutral: { background: colors.surfaceSoft, border: colors.border, text: colors.muted },
  success: { background: colors.primarySoft, border: colors.primary, text: colors.primaryDark },
  warning: { background: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  danger: { background: colors.dangerSoft, border: colors.danger, text: colors.danger },
  info: { background: '#EEF2FF', border: '#818CF8', text: '#3730A3' },
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Safe-area screen with an optional pull-to-refresh scroll view. */
export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  contentContainerStyle,
}: ScreenProps) {
  if (!scroll) {
    return <SafeAreaView style={screenStyles}>{children}</SafeAreaView>;
  }
  return (
    <SafeAreaView style={screenStyles} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[contentStyles, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  homeLink?: boolean;
}

/** Page header with an optional custom back button and dashboard link. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  right,
  homeLink = false,
}: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <View style={headerStyles}>
      <View style={headerRowStyles}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={({ pressed }) => [backButtonStyles, pressed ? { opacity: 0.7 } : null]}
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={eyebrowStyles}>{eyebrow}</Text> : null}
          <Text style={headerTitleStyles}>{title}</Text>
          {subtitle ? <Text style={subtitleStyles}>{subtitle}</Text> : null}
        </View>
        {right ?? null}
      </View>
      {homeLink ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to dashboard"
          onPress={() => router.replace('/(tabs)/dashboard')}
          style={backLinkStyles}
        >
          <Ionicons name="home-outline" size={14} color={colors.muted} />
          <Text style={backLinkTextStyles}>Dashboard</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Simple heading for a section inside a screen. */
export function SectionHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={sectionHeadStyles}>
      <View style={{ flex: 1 }}>
        <Text style={sectionTitleStyles}>{title}</Text>
        {subtitle ? <Text style={sectionSubtitleStyles}>{subtitle}</Text> : null}
      </View>
      {right ?? null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Surfaces and identity
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  tone = 'neutral',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
}) {
  const palette = TONES[tone];
  return (
    <View
      style={[
        cardStyles,
        tone === 'neutral' ? null : { backgroundColor: palette.background, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={dividerStyles} />;
}

export function Avatar({
  name,
  accent = colors.primary,
  size = 44,
}: {
  name: string;
  accent?: string;
  size?: number;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: `${accent}1F`,
        borderRadius: size / 2,
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      <Text style={{ color: accent, fontSize: size * 0.34, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

export function IconBadge({
  icon,
  tone = 'success',
  size = 44,
}: {
  icon: IoniconName;
  tone?: Tone;
  size?: number;
}) {
  const palette = TONES[tone];
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: palette.background,
        borderRadius: size / 3,
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      <Ionicons name={icon} size={size * 0.46} color={palette.text} />
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const palette = TONES[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: palette.background,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.border,
        paddingHorizontal: 9,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        chipStyles,
        selected ? chipSelectedStyles : null,
        disabled ? { opacity: 0.45 } : null,
        pressed && !disabled ? { opacity: 0.82 } : null,
      ]}
    >
      <Text style={selected ? chipTextSelectedStyles : chipTextStyles}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IoniconName;
}) {
  const blocked = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        secondaryButtonStyles,
        blocked ? { opacity: 0.5 } : null,
        pressed && !blocked ? { opacity: 0.8 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryDark} />
      ) : (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
          {icon ? <Ionicons name={icon} size={15} color={colors.primaryDark} /> : null}
          <Text style={secondaryButtonTextStyles}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function LabeledTextArea({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  minHeight = 92,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string;
  minHeight?: number;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={fieldLabelStyles}>{label}</Text>
      <TextInput
        multiline
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        textAlignVertical="top"
        style={[textAreaStyles, { minHeight }]}
      />
      {hint ? <Text style={hintStyles}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <View style={stateStyles}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={stateBodyStyles}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  body,
  action,
}: {
  icon?: IoniconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={stateStyles}>
      <View style={emptyIconStyles}>
        <Ionicons name={icon} size={24} color={colors.muted} />
      </View>
      <Text style={stateTitleStyles}>{title}</Text>
      {body ? <Text style={stateBodyStyles}>{body}</Text> : null}
      {action ? <View style={{ marginTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[stateStyles, errorStateStyles]}>
      <Ionicons name="alert-circle-outline" size={28} color={colors.danger} />
      <Text style={[stateTitleStyles, { color: colors.danger }]}>Something went wrong</Text>
      <Text style={stateBodyStyles}>{message}</Text>
      {onRetry ? <SecondaryButton label="Try again" onPress={onRetry} style={{ marginTop: spacing.sm }} /> : null}
    </View>
  );
}

export function InlineMessage({
  tone = 'info',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <View
      style={{
        backgroundColor: palette.background,
        borderColor: palette.border,
        borderRadius: radii.md,
        borderWidth: 1,
        padding: spacing.md,
      }}
    >
      <Text style={{ color: palette.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
        {children}
      </Text>
    </View>
  );
}

export function KeyValue({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={keyValueStyles}>
      <Text style={keyLabelStyles}>{label}</Text>
      <Text style={[keyValueTextStyles, strong ? { fontWeight: '700' } : null]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const screenStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.background,
  flex: 1,
};

const contentStyles: StyleProp<ViewStyle> = {
  gap: spacing.md,
  paddingBottom: spacing.xl,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
};

const headerStyles: StyleProp<ViewStyle> = {
  gap: spacing.sm,
  marginBottom: spacing.xs,
};

const headerRowStyles: StyleProp<ViewStyle> = {
  alignItems: 'flex-start',
  flexDirection: 'row',
  gap: spacing.sm,
};

const backButtonStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  height: 38,
  justifyContent: 'center',
  marginTop: 4,
  width: 38,
};

const backLinkStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  alignSelf: 'flex-start',
  flexDirection: 'row',
  gap: 4,
  paddingVertical: 2,
};

const backLinkTextStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600',
};

const eyebrowStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 1.3,
  marginBottom: 3,
  textTransform: 'uppercase',
};

const headerTitleStyles: StyleProp<TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 25,
  fontWeight: '600',
  letterSpacing: -0.6,
  lineHeight: 31,
};

const subtitleStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 19,
  marginTop: 4,
};

const sectionHeadStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: spacing.sm,
};

const sectionTitleStyles: StyleProp<TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 18,
  fontWeight: '600',
  letterSpacing: -0.4,
};

const sectionSubtitleStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  lineHeight: 17,
  marginTop: 2,
};

const cardStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.sm,
  padding: spacing.md,
  ...shadows.card,
};

const dividerStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.border,
  height: 1,
  width: '100%',
};

const chipStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.input,
  borderWidth: 1,
  justifyContent: 'center',
  minHeight: 38,
  paddingHorizontal: 13,
};

const chipSelectedStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const chipTextStyles: StyleProp<TextStyle> = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '600',
};

const chipTextSelectedStyles: StyleProp<TextStyle> = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const secondaryButtonStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.button,
  borderWidth: 1,
  justifyContent: 'center',
  minHeight: 42,
  paddingHorizontal: spacing.md,
};

const secondaryButtonTextStyles: StyleProp<TextStyle> = {
  color: colors.primaryDark,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700',
};

const fieldLabelStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600',
};

const textAreaStyles: StyleProp<TextStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 15,
  paddingHorizontal: 13,
  paddingVertical: 11,
  ...shadows.card,
};

const hintStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 12,
};

const stateStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.sm,
  justifyContent: 'center',
  padding: spacing.xl,
};

const errorStateStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.dangerSoft,
  borderColor: 'rgba(180, 35, 24, 0.28)',
};

const emptyIconStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surfaceSoft,
  borderRadius: 22,
  height: 44,
  justifyContent: 'center',
  width: 44,
};

const stateTitleStyles: StyleProp<TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600',
  textAlign: 'center',
};

const stateBodyStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 19,
  maxWidth: 300,
  textAlign: 'center',
};

const keyValueStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: spacing.sm,
  justifyContent: 'space-between',
};

const keyLabelStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600',
};

const keyValueTextStyles: StyleProp<TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 13,
  textAlign: 'right',
};

export { TONES };
