import { useState } from 'react';
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { LabeledInput } from '@/components/LabeledInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SubjectDropdown } from '@/components/SubjectDropdown';
import { Screen, ScreenHeader } from '@/components/ui';
import { ApiError, generateStudyPlan } from '@/lib/api';
import type { StudyPlan, StudyPlanLevel } from '@/lib/types';
import { colors, fonts, radii, shadows, spacing } from '@/theme';

const LEVELS: StudyPlanLevel[] = ['Beginner', 'Intermediate', 'Advanced'];

const CADENCES = [
  { label: 'Light', value: 'Light (~3 h/week)' },
  { label: 'Moderate', value: 'Moderate (~5 h/week)' },
  { label: 'Intense', value: 'Intense (~8 h/week)' },
] as const;

const WEEK_OPTIONS = [1, 2, 3, 4] as const;

/**
 * AI study-plan generator backed by POST /api/study-plan/generate/
 * (the backend's OpenRouter proxy). The subject is chosen from the shared
 * subject catalog through a searchable dropdown; the rest of the flow is
 * unchanged from the original scaffold. Phase 1 keeps that endpoint
 * unauthenticated — see docs/study-plan-security-risk.md.
 */
export default function StudyPlanScreen() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [weeks, setWeeks] = useState<number>(2);
  const [level, setLevel] = useState<StudyPlanLevel>('Intermediate');
  const [goal, setGoal] = useState('Understand the concepts');
  const [cadence, setCadence] = useState<string>(CADENCES[1].value);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!subject) {
      setError('Choose a subject to build the plan around.');
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const result = await generateStudyPlan({
        subject,
        topic: topic.trim() || undefined,
        weeks,
        level,
        goal: goal.trim() || 'Understand the concepts',
        cadence,
      });
      setPlan(result);
    } catch (err) {
      // The backend answers 502/503 with fallback: true when OpenRouter is
      // missing or failing — surface that as an "AI unavailable" state.
      setError(err instanceof ApiError ? err.message : 'AI generation is currently unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Study tools"
        title="Sketch a study path"
        subtitle="Pick a subject and a few settings, then preview a structured plan built by a live AI model."
        onBack={() => router.back()}
        homeLink
      />

      <View style={cardStyles}>
        <View style={sectionHeadStyles}>
          <View style={stepBadgeStyles}>
            <Text style={stepBadgeTextStyles}>1</Text>
          </View>
          <View>
            <Text style={sectionTitleStyles}>Set up your plan</Text>
            <Text style={sectionBodyStyles}>These choices shape the preview.</Text>
          </View>
        </View>

        <SubjectDropdown label="Subject" value={subject} onSelect={setSubject} />

        <View style={chipGroupStyles}>
          <Text style={chipLabelStyles}>Timeframe</Text>
          <View style={chipRowStyles}>
            {WEEK_OPTIONS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: weeks === option }}
                onPress={() => setWeeks(option)}
                style={({ pressed }) => [
                  chipStyles,
                  weeks === option ? chipSelectedStyles : null,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={weeks === option ? chipTextSelectedStyles : chipTextStyles}>
                  {option} week{option > 1 ? 's' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={chipGroupStyles}>
          <Text style={chipLabelStyles}>Current level</Text>
          <View style={chipRowStyles}>
            {LEVELS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: level === option }}
                onPress={() => setLevel(option)}
                style={({ pressed }) => [
                  chipStyles,
                  level === option ? chipSelectedStyles : null,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={level === option ? chipTextSelectedStyles : chipTextStyles}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <LabeledInput
          label="Goal"
          value={goal}
          onChangeText={setGoal}
          placeholder="e.g. Pass the midterm with confidence"
          returnKeyType="next"
        />

        <View style={chipGroupStyles}>
          <Text style={chipLabelStyles}>Weekly time</Text>
          <View style={chipRowStyles}>
            {CADENCES.map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected: cadence === option.value }}
                onPress={() => setCadence(option.value)}
                style={({ pressed }) => [
                  chipStyles,
                  cadence === option.value ? chipSelectedStyles : null,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={cadence === option.value ? chipTextSelectedStyles : chipTextStyles}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <LabeledInput
          label="Topic focus"
          hint="Optional — narrows the plan to a specific area."
          value={topic}
          onChangeText={setTopic}
          placeholder="e.g. eigenvectors, backprop, pointers…"
        />

        {error ? (
          <Text style={formErrorStyles}>{error}</Text>
        ) : null}

        <PrimaryButton
          label={loading ? 'Building preview…' : 'Generate study plan'}
          loading={loading}
          onPress={handleGenerate}
          style={{ marginTop: spacing.sm }}
        />
      </View>

      {error ? (
        <View style={errorCardStyles}>
          <View style={errorHeadStyles}>
            <Ionicons name="close-circle" size={18} color={colors.danger} />
            <View>
              <Text style={errorTitleStyles}>AI study plans are currently unavailable.</Text>
              <Text style={errorBodyStyles}>{error}</Text>
            </View>
          </View>
          <PrimaryButton label="Try again" onPress={handleGenerate} style={{ marginTop: spacing.sm }} />
        </View>
      ) : null}

      {plan ? <PlanView plan={plan} subject={subject} /> : null}
    </Screen>
  );
}

/** Rendered study plan: quick start, phase cards, tip, and attribution. */
function PlanView({ plan, subject }: { plan: StudyPlan; subject: string }) {
  return (
    <View style={planCardStyles}>
      <View>
        <Text style={eyebrowStyles}>Preview plan</Text>
        <Text style={planTitleStyles}>{subject}</Text>
      </View>

      {plan.disclaimer ? (
        <View style={disclaimerStyles}>
          <Ionicons name="eye-outline" size={15} color={colors.faint} />
          <Text style={disclaimerTextStyles}>{plan.disclaimer}</Text>
        </View>
      ) : null}

      {plan.firstSteps.length > 0 ? (
        <View style={quickStartStyles}>
          <Text style={h3Styles}>Quick start</Text>
          {plan.firstSteps.map((step, index) => (
            <View key={`${index}-${step}`} style={stepRowStyles}>
              <View style={idxBadgeStyles}>
                <Text style={idxBadgeTextStyles}>{index + 1}</Text>
              </View>
              <Text style={stepTextStyles}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {plan.phases.map((phase) => (
        <View key={phase.index} style={phaseStyles}>
          <View style={phaseHeadStyles}>
            <Text style={h3Styles}>{phase.title}</Text>
            <View style={weekTagStyles}>
              <Text style={weekTagTextStyles}>{`Week ${phase.index + 1}`}</Text>
            </View>
          </View>

          {phase.topics.length > 0 ? (
            <View style={chipRowStyles}>
              {phase.topics.map((entry) => (
                <View key={entry} style={topicPillStyles}>
                  <Text style={topicPillTextStyles}>{entry}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {phase.activities.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              {phase.activities.map((entry, index) => (
                <View key={`${index}-${entry}`} style={stepRowStyles}>
                  <View style={idxBadgeStyles}>
                    <Text style={idxBadgeTextStyles}>{index + 1}</Text>
                  </View>
                  <Text style={stepTextStyles}>{entry}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {phase.milestone ? (
            <View style={milestoneStyles}>
              <Ionicons name="checkmark" size={15} color={colors.success} />
              <Text style={milestoneTextStyles}>
                <Text style={{ fontWeight: '700' }}>By the end: </Text>
                {phase.milestone}
              </Text>
            </View>
          ) : null}
        </View>
      ))}

      {plan.tip ? (
        <View style={tipStyles}>
          <Ionicons name="sparkles" size={15} color={colors.primary} />
          <Text style={tipTextStyles}>{plan.tip}</Text>
        </View>
      ) : null}
    </View>
  );
}

const eyebrowStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 10,
  fontWeight: '700',
  letterSpacing: 1.4,
  marginBottom: spacing.xs,
  textTransform: 'uppercase',
};

const cardStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.md,
  padding: 18,
  ...shadows.card,
};

const sectionHeadStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: 12,
};

const stepBadgeStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.primarySoft,
  borderRadius: 13,
  height: 26,
  justifyContent: 'center',
  width: 26,
};

const stepBadgeTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.primary,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const sectionTitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 18,
  fontWeight: '600',
  letterSpacing: -0.45,
};

const sectionBodyStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  marginTop: 2,
};

const chipGroupStyles: StyleProp<ViewStyle | TextStyle> = {
  gap: spacing.sm,
};

const chipLabelStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
};

const chipRowStyles: StyleProp<ViewStyle | TextStyle> = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: spacing.sm,
};

/** Web .secondary-button / choice style: 40px tall, 9px radius, 1px line. */
const chipStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.input,
  borderWidth: 1,
  minHeight: 40,
  paddingHorizontal: 14,
};

const chipSelectedStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.primarySoft,
  borderColor: colors.primary,
};

const chipTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const chipTextSelectedStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.primary,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '700',
};

const formErrorStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.danger,
  fontFamily: fonts.body,
  fontSize: 13,
  fontWeight: '500',
};

const errorCardStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.dangerSoft,
  borderColor: 'rgba(180, 35, 24, 0.28)',
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.sm,
  padding: 16,
};

const errorHeadStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'flex-start',
  flexDirection: 'row',
  gap: spacing.sm,
};

const errorTitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.danger,
  fontFamily: fonts.body,
  fontSize: 14,
  fontWeight: '700',
};

const errorBodyStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: 18,
  marginTop: 2,
};

const planCardStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.lg,
  borderWidth: 1,
  gap: spacing.md,
  padding: 18,
  ...shadows.soft,
};

const planTitleStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 22,
  fontWeight: '600',
  letterSpacing: -0.5,
};

const disclaimerStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: spacing.sm,
};

const disclaimerTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.faint,
  fontFamily: fonts.body,
  flex: 1,
  fontSize: 12,
  lineHeight: 17,
};

const h3Styles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: 16,
  fontWeight: '600',
  letterSpacing: -0.4,
};

const quickStartStyles: StyleProp<ViewStyle | TextStyle> = {
  gap: spacing.sm,
};

const stepRowStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'flex-start',
  flexDirection: 'row',
  gap: 10,
};

const idxBadgeStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.primarySoft,
  borderRadius: 10,
  height: 20,
  justifyContent: 'center',
  marginTop: 1,
  width: 20,
};

const idxBadgeTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.primary,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '700',
};

const stepTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  flex: 1,
  fontFamily: fonts.body,
  fontSize: 14,
  lineHeight: 20,
};

const phaseStyles: StyleProp<ViewStyle | TextStyle> = {
  backgroundColor: colors.surfaceSoft,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  gap: spacing.sm,
  padding: spacing.md,
};

const phaseHeadStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  flexDirection: 'row',
  gap: spacing.sm,
};

const weekTagStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: 999,
  borderWidth: 1,
  justifyContent: 'center',
  paddingHorizontal: 9,
  paddingVertical: 3,
};

const weekTagTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0.5,
};

const topicPillStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: 999,
  borderWidth: 1,
  justifyContent: 'center',
  paddingHorizontal: 10,
  paddingVertical: 4,
};

const topicPillTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.muted,
  fontFamily: fonts.body,
  fontSize: 12,
  fontWeight: '500',
};

const milestoneStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'center',
  backgroundColor: colors.primarySoft,
  borderRadius: radii.md,
  flexDirection: 'row',
  gap: spacing.sm,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
};

const milestoneTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.body,
  flex: 1,
  fontSize: 13,
  lineHeight: 19,
};

const tipStyles: StyleProp<ViewStyle | TextStyle> = {
  alignItems: 'flex-start',
  backgroundColor: colors.primarySoft,
  borderRadius: radii.md,
  flexDirection: 'row',
  gap: spacing.sm,
  padding: spacing.md,
};

const tipTextStyles: StyleProp<ViewStyle | TextStyle> = {
  color: colors.text,
  fontFamily: fonts.body,
  flex: 1,
  fontSize: 14,
  lineHeight: 20,
};
