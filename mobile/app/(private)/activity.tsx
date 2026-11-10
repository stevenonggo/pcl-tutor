import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconBadge,
  LoadingState,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/components/ui';
import { useAsyncData } from '@/hooks/useAsyncData';
import { listActivity } from '@/lib/api';
import { statusLabel, statusTone } from '@/lib/booking';
import { relativeTime } from '@/lib/datetime';
import type { ActivityItem } from '@/lib/types';
import { colors, fonts, spacing } from '@/theme';

function iconFor(item: ActivityItem): keyof typeof Ionicons.glyphMap {
  if (item.status === 'Pending') {
    return 'hourglass-outline';
  }
  if (item.status === 'Suggested') {
    return 'calendar-outline';
  }
  if (item.status === 'Confirmed') {
    return 'checkmark-circle-outline';
  }
  return 'close-circle-outline';
}

export default function ActivityScreen() {
  const router = useRouter();
  const { data, loading, refreshing, error, reload, refresh } = useAsyncData<ActivityItem[]>(
    () => listActivity(),
    [],
    { refreshOnFocus: true },
  );

  const items = data ?? [];
  const grouped = useMemo(() => {
    const pending = items.filter(
      (item) => item.status === 'Pending' || item.status === 'Suggested',
    );
    const other = items.filter(
      (item) => item.status !== 'Pending' && item.status !== 'Suggested',
    );
    return { pending, other };
  }, [items]);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeader
        eyebrow="Activity"
        title="What changed"
        subtitle="A calm timeline for the updates around your requests and sessions."
        onBack={() => router.back()}
        homeLink
      />

      {loading && !data ? <LoadingState label="Loading activity..." /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="No updates yet."
          body="Updates will appear here as your requests and sessions change."
        />
      ) : null}

      {grouped.pending.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeading
            title="Needs attention"
            subtitle="Requests that are still moving."
            right={<Badge label={String(grouped.pending.length)} tone="warning" />}
          />
          {grouped.pending.map((item) => (
            <ActivityRow key={item.id} item={item} onPress={() => router.push('/(tabs)/requests')} />
          ))}
        </Card>
      ) : null}

      {grouped.other.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeading title="Recent updates" subtitle="Confirmed and closed sessions." />
          {grouped.other.map((item) => (
            <ActivityRow key={item.id} item={item} onPress={() => router.push('/(tabs)/sessions')} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function ActivityRow({ item, onPress }: { item: ActivityItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [rowStyles, pressed ? { opacity: 0.8 } : null]}
    >
      <IconBadge
        icon={iconFor(item)}
        tone={statusTone(item.status)}
        size={38}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={textStyles}>{item.text}</Text>
        <View style={metaRowStyles}>
          <Badge
            label={statusLabel(item.status)}
            tone={statusTone(item.status)}
          />
          <Text style={timeStyles}>{relativeTime(item.at)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  );
}

const rowStyles = {
  alignItems: 'center' as const,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  flexDirection: 'row' as const,
  gap: spacing.sm,
  paddingTop: spacing.sm,
};

const textStyles = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 18,
};

const metaRowStyles = {
  alignItems: 'center' as const,
  flexDirection: 'row' as const,
  gap: 8,
};

const timeStyles = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
};
