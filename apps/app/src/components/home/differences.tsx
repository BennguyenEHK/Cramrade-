import { StyleSheet, View } from 'react-native';

import { Section, sectionStyles } from '@/components/frame/section';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

/** The two things that set Cramrade apart, and a plain statement of where notes go. */
export function Differences() {
  const { colors } = useTheme();
  const { wide } = useLayout();

  return (
    <Section rule>
      <AppText variant="headline" style={sectionStyles.heading}>
        What makes it different
      </AppText>

      <View style={[styles.columns, wide && styles.columnsWide]}>
        <View style={styles.item}>
          <AppText variant="title" style={styles.title}>
            Built around the date, not around a streak
          </AppText>
          <AppText tone="inkMuted" style={styles.body}>
            The plan is plain arithmetic between today and your exam, not a guess. Sessions get
            closer together as the day approaches, and the plan ends on exam day. Change the date and
            the whole plan moves with it. Reminders come from the plan, and you can add the sessions
            to your own calendar.
          </AppText>
        </View>

        <View style={styles.item}>
          <AppText variant="title" style={styles.title}>
            Questions from your notes, and only your notes
          </AppText>
          <AppText tone="inkMuted" style={styles.body}>
            Cramrade never adds to what you wrote. Each question names the piece of your notes it
            came from, and the app checks that quote really exists before showing you the question.
            A question that cannot be traced is dropped, not patched. Group quizzes work the same way,
            from the notes the group shares.
          </AppText>
        </View>
      </View>

      <View style={[styles.notice, { borderTopColor: colors.line }]}>
        <AppText bold style={styles.noticeTitle}>
          Where your notes go
        </AppText>
        <AppText tone="inkMuted" style={styles.body}>
          The text of your notes is sent to our server and to the AI that writes the questions.
          Uploaded files and photos are deleted once their text has been read. Cramrade never looks
          through your device for files and never reads your calendar.
        </AppText>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  columns: {
    gap: Spacing.xl,
  },
  columnsWide: {
    flexDirection: 'row',
    gap: Spacing.xxl,
  },
  item: {
    flex: 1,
    gap: Spacing.sm,
  },
  title: {
    maxWidth: 420,
  },
  body: {
    maxWidth: Layout.proseMaxWidth,
  },
  notice: {
    marginTop: Spacing.xxl,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    gap: Spacing.xs,
  },
  noticeTitle: {},
});
