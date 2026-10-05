import { StyleSheet, View } from 'react-native';

import { Section, sectionStyles } from '@/components/frame/section';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

const STEPS = [
  {
    title: 'Add the exam date',
    text: 'Type it in, or upload the syllabus and confirm the dates Cramrade finds in it. Nothing is saved until you say so.',
  },
  {
    title: 'Add your notes',
    text: 'Upload Word, PDF or text files. Later, photograph paper notes with the phone app. Files are read for their text and then deleted. Only the text stays.',
  },
  {
    title: 'Study in short sessions',
    text: 'Each session is 5 to 7 questions written from your notes. Every question can show you the exact lines it came from. A reminder tells you when a session is due.',
  },
  {
    title: 'Quiz your group',
    text: 'Host a live quiz in the browser and share a link. Classmates join from any device and answer questions made from the whole group’s notes.',
  },
];

/** The four steps, in order. They are a real sequence, so they are numbered. */
export function HowItWorks() {
  const { colors } = useTheme();
  const { wide } = useLayout();

  return (
    <Section rule>
      <AppText variant="headline" style={sectionStyles.heading}>
        How it works
      </AppText>
      <View role="list">
        {STEPS.map((step, i) => (
          <View
            key={step.title}
            role="listitem"
            style={[
              styles.row,
              wide && styles.rowWide,
              { borderTopColor: colors.line },
              i === 0 && styles.firstRow,
            ]}>
            <AppText variant="title" tone="session" style={[styles.number, wide && styles.numberWide]}>
              {i + 1}
            </AppText>
            <View style={styles.text}>
              <AppText variant="title" style={styles.title}>
                {step.title}
              </AppText>
              <AppText tone="inkMuted" style={styles.body}>
                {step.text}
              </AppText>
            </View>
          </View>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    borderTopWidth: 1,
  },
  rowWide: {
    gap: Spacing.xl,
    paddingVertical: Spacing.xl,
  },
  firstRow: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  number: {
    width: 28,
  },
  numberWide: {
    width: 64,
  },
  text: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {},
  body: {
    maxWidth: Layout.proseMaxWidth,
  },
});
