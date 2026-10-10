import { useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

import { TrialButton } from './trial-button';

const ANSWERS = ['Mitochondria', 'Ribosome', 'Golgi apparatus', 'Nucleus'];
const PLAYERS = [
  { name: 'Linh', score: 2400 },
  { name: 'Sam', score: 2150 },
  { name: 'Priya', score: 1900 },
  { name: 'Diego', score: 1320 },
  { name: 'Ama', score: 980 },
];

/**
 * B1 trial, part two: a wide screen like the quiz host page, edge to edge.
 * Shows its own measured width next to the window width so the check is visible.
 */
export function HostMock() {
  const { colors } = useTheme();
  const { wide } = useLayout();
  const window = useWindowDimensions();
  const [panelWidth, setPanelWidth] = useState(0);

  function goFullScreen() {
    if (Platform.OS !== 'web') return;
    const root = globalThis.document?.documentElement;
    if (root?.requestFullscreen) {
      root.requestFullscreen().catch(() => undefined);
    }
  }

  const fillsWindow = panelWidth > 0 && Math.abs(panelWidth - window.width) <= 1;

  return (
    <View
      testID="host-mock"
      onLayout={(event) => setPanelWidth(Math.round(event.nativeEvent.layout.width))}
      style={[styles.panel, { backgroundColor: colors.ink }]}>
      <View style={styles.topRow}>
        <AppText tone="onInk" bold>
          Question 3 of 10
        </AppText>
        <AppText testID="host-width" tone="onInk" variant="small">
          Width {panelWidth} of window {Math.round(window.width)}: {fillsWindow ? 'full width' : 'not full width'}
        </AppText>
      </View>

      <View style={[styles.timerTrack, { backgroundColor: colors.inkMuted }]}>
        <View style={[styles.timerFill, { backgroundColor: colors.session }]} />
      </View>

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={styles.question}>
          <AppText variant="display" tone="onInk">
            Which part of the cell makes most of its energy?
          </AppText>
          <View style={styles.answers}>
            {ANSWERS.map((answer, index) => (
              <View
                key={answer}
                style={[
                  styles.answer,
                  wide && styles.answerWide,
                  { borderColor: colors.inkMuted },
                ]}>
                <AppText tone="onInk" variant="lead">
                  {String.fromCharCode(65 + index)}. {answer}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.board, wide && styles.boardWide, { borderColor: colors.inkMuted }]}>
          <AppText variant="title" tone="onInk">
            Scores
          </AppText>
          {PLAYERS.map((player, index) => (
            <View key={player.name} style={styles.boardRow}>
              <AppText tone="onInk">
                {index + 1}. {player.name}
              </AppText>
              <AppText tone="onInk" bold>
                {player.score}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      {Platform.OS === 'web' && <TrialButton label="Show full screen" onPress={goFullScreen} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    minHeight: 640,
    padding: Layout.gutterWide,
    gap: Spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  timerTrack: {
    height: 8,
    borderRadius: Radius.chip,
    overflow: 'hidden',
  },
  timerFill: {
    width: '62%',
    height: '100%',
  },
  body: {
    gap: Spacing.xl,
  },
  bodyWide: {
    flexDirection: 'row',
  },
  question: {
    flex: 1,
    gap: Spacing.xl,
  },
  answers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  answer: {
    width: '100%',
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderRadius: Radius.panel,
  },
  answerWide: {
    width: '48%',
    flexGrow: 1,
  },
  board: {
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderRadius: Radius.panel,
  },
  boardWide: {
    width: 320,
  },
  boardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
