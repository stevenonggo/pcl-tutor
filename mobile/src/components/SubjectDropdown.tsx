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

import { SUBJECTS } from '@/data/subjects';
import { filterSubjects } from '@/lib/subjects';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

interface SubjectDropdownProps {
  label: string;
  /** Currently selected subject; an empty string means nothing chosen yet. */
  value: string;
  /** Called with the chosen subject when a row is tapped. */
  onSelect: (subject: string) => void;
  placeholder?: string;
  /** Catalog override; defaults to the shared subject list. */
  subjects?: readonly string[];
}

/**
 * Searchable subject picker, styled after the web app's SelectField.
 *
 * The closed control looks like a standard input field; tapping it opens a
 * modal sheet with a search box and the filtered catalog. Tapping a row
 * selects it and closes the sheet.
 */
export function SubjectDropdown({
  label,
  value,
  onSelect,
  placeholder = 'Choose a subject',
  subjects = SUBJECTS,
}: SubjectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => filterSubjects(query, subjects), [query, subjects]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={{ gap: 7 }}>
      <Text style={labelStyles}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [fieldStyles, pressed ? { backgroundColor: colors.surfaceSoft } : null]}
      >
        <Text numberOfLines={1} style={value ? valueStyles : placeholderStyles}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down-outline" size={18} color={colors.faint} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View style={modalStyles}>
          <View style={searchStyles}>
            <Ionicons name="search-outline" size={16} color={colors.faint} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search subjects…"
              placeholderTextColor={colors.faint}
              style={searchInputStyles}
            />
            {query ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>

          <View style={modalHeaderStyles}>
            <Text style={eyebrowStyles}>Subject catalog</Text>
            <Pressable accessibilityRole="button" onPress={close} style={closeButtonStyles}>
              <Text style={closeTextStyles}>Done</Text>
            </Pressable>
          </View>

          {results.length === 0 ? (
            <Text style={emptyStyles}>No subjects match “{query.trim()}”.</Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item}
              contentContainerStyle={{ gap: 6, padding: 12 }}
              renderItem={({ item }) => {
                const selected = item === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onSelect(item);
                      close();
                    }}
                    style={({ pressed }) => [
                      rowStyles,
                      selected ? rowSelectedStyles : null,
                      pressed ? { backgroundColor: colors.surfaceSoft } : null,
                    ]}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    ) : (
                      <View style={rowIconPlaceholderStyles} />
                    )}
                    <Text numberOfLines={1} style={rowTextStyles}>
                      {item}
                    </Text>
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
  fontFamily: fonts.body,
  flex: 1,
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
};

const rowSelectedStyles: StyleProp<ViewStyle> = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const rowIconPlaceholderStyles: StyleProp<ViewStyle> = {
  width: 18,
};

const rowTextStyles: StyleProp<TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '500',
};

const emptyStyles: StyleProp<TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 13,
  marginHorizontal: 14,
  marginTop: spacing.md,
};
