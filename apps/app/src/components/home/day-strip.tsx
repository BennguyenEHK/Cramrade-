import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

/**
 * A fixed example plan: sessions per day for the 21 days before an exam.
 * Same shape the schedule engine will produce. Sessions get denser near the end.
 */
const PLAN = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 2, 2];
const SESSIONS = PLAN.reduce((sum, n) => sum + n, 0);
const DAYS = PLAN.length;
const WEEKS = DAYS / 7;

const BAR_HEIGHT = 20;
const BAR_GAP = 4;
const STRIP_HEIGHT = BAR_HEIGHT * 2 + BAR_GAP;
const RISE_MS = 420;
const STAGGER_MS = 28;

/** The hero picture: today to exam day, with study sessions placed on it. */
export function DayStrip() {
  const { colors } = useTheme();
  const { wide } = useLayout();
  const reduceMotion = useReducedMotion();

  const columnGap = wide ? 6 : 3;
  const markerWidth = wide ? 16 : 12;

  return (
    <View>
      <View aria-hidden style={[styles.strip, { gap: columnGap }]}>
        {PLAN.map((count, day) => (
          <View key={day} style={styles.column}>
            {Array.from({ length: count }, (_, i) => (
              <Bar key={i} color={colors.session} delay={day * STAGGER_MS} reduceMotion={reduceMotion} />
            ))}
          </View>
        ))}
        <View
          style={[
            styles.marker,
            { width: markerWidth, backgroundColor: colors.exam, borderRadius: Radius.chip },
          ]}
        />
      </View>

      <View style={[styles.baseline, { backgroundColor: colors.line }]} />

      <View style={[styles.labels, { gap: columnGap }]}>
        {Array.from({ length: WEEKS }, (_, week) => (
          <View
            key={week}
            style={[
              styles.week,
              { borderLeftColor: colors.line, paddingLeft: wide ? Spacing.xs : Spacing.xxs },
            ]}>
            <AppText variant="small" tone={week === 0 ? 'ink' : 'inkMuted'} bold={week === 0}>
              {week === 0 ? 'Today' : `Week ${week + 1}`}
            </AppText>
          </View>
        ))}
        <View style={[styles.markerLabel, { minWidth: markerWidth }]}>
          <AppText variant="small" tone="exam" bold style={styles.examText}>
            Exam day
          </AppText>
        </View>
      </View>

      <AppText variant="small" tone="inkMuted" style={styles.caption}>
        Example: {DAYS} days to an exam, {SESSIONS} short sessions, placed closer together as the day
        gets near.
      </AppText>
    </View>
  );
}

/** One session. Rises into place once on load, unless the system asks for reduced motion. */
function Bar({ color, delay, reduceMotion }: { color: string; delay: number; reduceMotion: boolean }) {
  const scale = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withDelay(
      200 + delay,
      withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, reduceMotion, scale]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
  }));

  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: color, borderRadius: Radius.chip / 2 }, animated]}
    />
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: STRIP_HEIGHT,
  },
  column: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: BAR_GAP,
  },
  bar: {
    height: BAR_HEIGHT,
    transformOrigin: 'bottom',
  },
  marker: {
    height: STRIP_HEIGHT,
  },
  baseline: {
    height: 1,
    marginTop: Spacing.xs,
  },
  labels: {
    flexDirection: 'row',
    marginTop: Spacing.xs,
  },
  week: {
    flex: 7,
    borderLeftWidth: 1,
  },
  markerLabel: {
    alignItems: 'flex-end',
  },
  examText: {
    textAlign: 'right',
    width: 70,
    marginRight: -Spacing.xs,
  },
  caption: {
    marginTop: Spacing.md,
  },
});
