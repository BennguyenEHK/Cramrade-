import { type Href } from 'expo-router';
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
  /** Main way onward. When set, it is shown as the main button above the homepage link. */
  link?: { href: Href; label: string };
};

/**
 * A stand-in screen for a feature that is not built yet.
 * Used by the workspace route until tasks B3 to B7 replace it.
 */
export function Placeholder({ title, text, link }: Props) {
  return (
    <Page>
      <PageHead title={title} />
      <Section>
        <View style={styles.copy}>
          <AppText variant="headline">{title}</AppText>
          <AppText tone="inkMuted">{text}</AppText>
          <View style={styles.actions}>
            {link && <LinkButton href={link.href}>{link.label}</LinkButton>}
            <LinkButton href="/" variant="quiet">
              Back to the homepage
            </LinkButton>
          </View>
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
});
