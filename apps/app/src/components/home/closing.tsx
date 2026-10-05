import { StyleSheet, View } from 'react-native';

import { Section } from '@/components/frame/section';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';

/** The last section: one question and the way in. */
export function Closing() {
  const { wide } = useLayout();

  return (
    <Section ink>
      <View style={[styles.row, wide && styles.rowWide]}>
        <View style={styles.copy}>
          <AppText variant="headline" tone="onInk" style={styles.headline}>
            Got an exam coming up?
          </AppText>
          <AppText variant="lead" tone="onInk" style={styles.lead}>
            Add the date, add your notes, and let the plan work backwards from exam day.
          </AppText>
        </View>
        <LinkButton href="/sign-in" size="large">
          Sign in
        </LinkButton>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.xl,
  },
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copy: {
    flexShrink: 1,
    gap: Spacing.md,
  },
  headline: {},
  lead: {
    maxWidth: Layout.proseMaxWidth,
    opacity: 0.8,
  },
});
