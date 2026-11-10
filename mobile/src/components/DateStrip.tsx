import { Pressable, ScrollView, Text, View } from 'react-native';

import { dayOfMonth, formatDate, monthShort, weekdayShort } from '@/lib/datetime';
import { colors, fonts, radii, spacing } from '@/theme';

interface DateStripProps {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
  counts?: Record<string, number>;
  countLabel?: string;
}

/** Horizontal day picker used by tutor details, booking, and availability. */
export function DateStrip({ dates, selected, onSelect, counts, countLabel = 'open' }: DateStripProps) {
  return (
    <View style={{ gap: spacing.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {dates.map((date) => {
          const isSelected = date === selected;
          const count = counts?.[date];
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={formatDate(date)}
              onPress={() => onSelect(date)}
              style={({ pressed }) => [
                dayStyles,
                isSelected ? daySelectedStyles : null,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={isSelected ? dayWeekdaySelectedStyles : dayWeekdayStyles}>
                {weekdayShort(date)}
              </Text>
              <Text style={isSelected ? dayNumberSelectedStyles : dayNumberStyles}>
                {dayOfMonth(date)}
              </Text>
              <Text style={isSelected ? dayMetaSelectedStyles : dayMetaStyles}>
                {typeof count === 'number' ? `${count} ${countLabel}` : monthShort(date)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const dayStyles = {
  alignItems: 'center' as const,
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  gap: 1,
  justifyContent: 'center' as const,
  minWidth: 64,
  paddingHorizontal: 10,
  paddingVertical: 9,
};

const daySelectedStyles = {
  backgroundColor: colors.primary,
  borderColor: colors.primary,
};

const dayWeekdayStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 0.6,
  textTransform: 'uppercase' as const,
};

const dayWeekdaySelectedStyles = {
  color: 'rgba(255,255,255,0.78)',
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700' as const,
  letterSpacing: 0.6,
  textTransform: 'uppercase' as const,
};

const dayNumberStyles = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 19,
  fontWeight: '600' as const,
};

const dayNumberSelectedStyles = {
  color: colors.surface,
  fontFamily: fonts.heading,
  fontSize: 19,
  fontWeight: '600' as const,
};

const dayMetaStyles = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '600' as const,
};

const dayMetaSelectedStyles = {
  color: 'rgba(255,255,255,0.78)',
  fontFamily: fonts.body,
  fontSize: 9,
  fontWeight: '600' as const,
};
