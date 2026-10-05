import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The Cramrade name with the exam day marker from the hero strip beside it. */
export function Wordmark({ size = 24 }: { size?: number }) {
  const { colors } = useTheme();
  const mark = Math.round(size * 0.3);
  return (
    <View style={styles.row} accessible accessibilityLabel="Cramrade">
      <Text
        style={{
          fontFamily: Fonts.displayHeavy,
          fontSize: size,
          lineHeight: Math.round(size * 1.1),
          letterSpacing: -0.02 * size,
          color: colors.ink,
        }}>
        Cramrade
      </Text>
      <View
        style={{
          width: mark,
          height: mark,
          borderRadius: Math.max(2, Math.round(mark * 0.3)),
          backgroundColor: colors.exam,
          marginLeft: Math.round(size * 0.2),
          marginBottom: Math.round(size * 0.1),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
