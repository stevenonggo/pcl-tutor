import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radii, shadows, spacing } from '@/theme';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  emptyLabel?: string;
}

/**
 * Generic dropdown with an optional search box. Used for tutor selection and
 * other finite option lists; the subject catalog keeps its dedicated picker.
 */
export function SelectField({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Choose an option',
  searchable = false,
  emptyLabel = 'No options available.',
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.value === value) ?? null;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.description?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={{ gap: 7 }}>
      <Text style={labelStyles}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [fieldStyles, pressed ? { backgroundColor: colors.surfaceSoft } : null]}
      >
        <Text numberOfLines={1} style={selected ? valueStyles : placeholderStyles}>
          {selected?.label || placeholder}
        </Text>
        <Ionicons name="chevron-down-outline" size={18} color={colors.faint} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={modalStyles}>
          {searchable ? (
            <View style={searchStyles}>
              <Ionicons name="search-outline" size={16} color={colors.faint} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search..."
                placeholderTextColor={colors.faint}
                style={searchInputStyles}
              />
              {query ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={modalHeaderStyles}>
            <Text style={eyebrowStyles}>{label}</Text>
            <Pressable accessibilityRole="button" onPress={close} style={closeButtonStyles}>
              <Text style={closeTextStyles}>Done</Text>
            </Pressable>
          </View>

          {visible.length === 0 ? (
            <Text style={emptyStyles}>{emptyLabel}</Text>
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(item) => item.value}
              contentContainerStyle={{ gap: 6, padding: 12 }}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onSelect(item.value);
                      close();
                    }}
                    style={({ pressed }) => [
                      rowStyles,
                      isSelected ? rowSelectedStyles : null,
                      pressed ? { backgroundColor: colors.surfaceSoft } : null,
                    ]}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark' : 'ellipse-outline'}
                      size={18}
                      color={isSelected ? colors.primary : colors.faint}
                    />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={rowTextStyles}>
                        {item.label}
                      </Text>
                      {item.description ? (
                        <Text numberOfLines={2} style={rowDescriptionStyles}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const labelStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '600',
};

const fieldStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  flexDirection: 'row',
  gap: spacing.sm,
  justifyContent: 'space-between',
  minHeight: 46,
  paddingHorizontal: 13,
  ...shadows.card,
};

const valueStyles: StyleProp<TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 15,
};

const placeholderStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 15,
};

const modalStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.background,
  flex: 1,
  paddingBottom: 24,
};

const searchStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.input,
  borderWidth: 1,
  flexDirection: 'row',
  gap: spacing.sm,
  marginHorizontal: 12,
  marginTop: 12,
  minHeight: 44,
  paddingHorizontal: 12,
};

const searchInputStyles: StyleProp<TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 15,
  padding: 0,
};

const modalHeaderStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginHorizontal: 14,
  marginTop: spacing.md,
};

const eyebrowStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 1.4,
  textTransform: 'uppercase',
};

const closeButtonStyles: StyleProp<ViewStyle> = {
  borderRadius: radii.button,
  minHeight: 36,
  paddingHorizontal: 12,
};

const closeTextStyles: StyleProp<TextStyle> = {
  color: colors.primary,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const rowStyles: StyleProp<ViewStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.button,
  borderWidth: 1,
  flexDirection: 'row',
  gap: spacing.sm,
  minHeight: 44,
  paddingHorizontal: 12,
  paddingVertical: 8,
};

const rowSelectedStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const rowTextStyles: StyleProp<TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '500',
};

const rowDescriptionStyles: StyleProp<TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  marginTop: 1,
};

const emptyStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 13,
  marginHorizontal: 14,
  marginTop: spacing.md,
};
