import { StyleSheet, View } from 'react-native';

import { Section } from '@/components/frame/section';
import { DayStrip } from '@/components/home/day-strip';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';

export function Hero() {
  const { wide } = useLayout();

  return (
    <Section style={{ paddingTop: wide ? Spacing.sectionWide : Spacing.xxl }}>
      <View style={styles.copy}>
        <AppText variant="display" style={styles.headline}>
          Your notes, planned backwards from exam day.
        </AppText>
        <AppText variant="lead" tone="inkMuted" style={styles.lead}>
          Add the exam date and the notes you already have. Cramrade places short study sessions
          between now and then, more often as the day gets near, and asks you questions made from
          what you wrote.
        </AppText>
        <View style={styles.actions}>
          <LinkButton href="/sign-in" size="large">
            Start a plan
          </LinkButton>
          <AppText variant="small" tone="inkMuted">
            Works in the browser. Nothing to install.
          </AppText>
        </View>
      </View>

      <View style={{ marginTop: wide ? Spacing.sectionWide : Spacing.section }}>
        <DayStrip />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  copy: {
    maxWidth: 820,
  },
  headline: {
    marginBottom: Spacing.lg,
  },
  lead: {
    maxWidth: Layout.proseMaxWidth,
    marginBottom: Spacing.xl,
  },
  actions: {
    gap: Spacing.sm,
  },
});
