import Head from 'expo-router/head';
import { StyleSheet, View } from 'react-native';

import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Section } from '@/components/frame/section';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { HostMock } from '@/features/web-trial/host-mock';
import { PdfCheck } from '@/features/web-trial/pdf-check';

/**
 * TRIAL PAGE for task B1. Throwaway code: delete this route and
 * src/features/web-trial once the real upload button (B4) exists.
 * The result is kept in docs/trials/b1-web-trial.md.
 */
export default function TrialScreen() {
  return (
    <Page>
      <PageHead title="Web trial" />
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <Section>
        <View style={styles.intro}>
          <AppText variant="headline">Web trial</AppText>
          <AppText tone="inkMuted">
            Two checks for the web version of the app: uploading a PDF, and a wide screen for
            hosting a quiz. This page is a test and will be removed.
          </AppText>
        </View>
        <PdfCheck />
      </Section>
      <Section rule>
        <AppText variant="title">2. Wide quiz screen</AppText>
      </Section>
      <HostMock />
    </Page>
  );
}

const styles = StyleSheet.create({
  intro: {
    maxWidth: Layout.proseMaxWidth,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
});
