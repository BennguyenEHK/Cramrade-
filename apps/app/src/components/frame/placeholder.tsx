import { StyleSheet, View } from 'react-native';

import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Section } from '@/components/frame/section';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  text: string;
};

/**
 * A stand-in screen for a feature that is not built yet.
 * Used by the workspace and sign-in routes until Dev B replaces them.
 */
export function Placeholder({ title, text }: Props) {
  return (
    <Page>
      <PageHead title={title} />
      <Section>
        <View style={styles.copy}>
          <AppText variant="headline">{title}</AppText>
          <AppText tone="inkMuted">{text}</AppText>
          <LinkButton href="/" variant="quiet" style={styles.back}>
            Back to the homepage
          </LinkButton>
        </View>
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  copy: {
    maxWidth: Layout.proseMaxWidth,
    gap: Spacing.md,
  },
  back: {
    marginTop: Spacing.md,
  },
});
