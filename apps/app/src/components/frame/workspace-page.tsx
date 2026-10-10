import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Page } from './page';
import { PageHead } from './page-head';
import { Section } from './section';
import { Placeholder } from './placeholder';
import { AppText } from '@/components/ui/text';
import { LinkButton } from '@/components/ui/link-button';
import { useAuth } from '@/features/auth/auth-provider';
import { Spacing } from '@/constants/theme';

export function MemberScreen({
  title,
  children,
}: {
  title: string;
  children: (ownerId: string) => ReactNode;
}) {
  const { session, loading } = useAuth();
  if (loading) return <Placeholder title={title} text="Checking your account…" />;
  if (!session || session.user.is_anonymous)
    return (
      <Placeholder
        title={title}
        text="Sign in to open your study workspace."
        link={{ href: '/sign-in', label: 'Sign in' }}
      />
    );
  return (
    <View key={session.user.id} style={{ flex: 1 }}>
      {children(session.user.id)}
    </View>
  );
}

export function WorkspaceLinks() {
  return (
    <View style={workspaceStyles.actions}>
      <LinkButton href="/workspace" variant="quiet">
        Exams
      </LinkButton>
      <LinkButton href="/notes" variant="quiet">
        Notes
      </LinkButton>
      <LinkButton href="/syllabus" variant="quiet">
        Syllabus
      </LinkButton>
      <LinkButton href="/schedule" variant="quiet">
        Schedule
      </LinkButton>
      <LinkButton href="/study" variant="quiet">
        Study
      </LinkButton>
      <LinkButton href="/quiz" variant="quiet">
        Quiz
      </LinkButton>
      <LinkButton href="/settings" variant="quiet">
        Study settings
      </LinkButton>
    </View>
  );
}

export function WorkspacePage({
  title,
  intro,
  children,
  fullWidth = false,
}: {
  title: string;
  intro: string;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <Page>
      <PageHead title={title} />
      <Section style={[workspaceStyles.stack, fullWidth && { maxWidth: '100%' }]}>
        <View style={workspaceStyles.stack}>
          <AppText variant="headline">{title}</AppText>
          <AppText tone="inkMuted" style={{ maxWidth: 680 }}>
            {intro}
          </AppText>
        </View>
        <WorkspaceLinks />
        {children}
      </Section>
    </Page>
  );
}

export const workspaceStyles = StyleSheet.create({
  stack: { gap: Spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center' },
  panel: {
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    borderTopWidth: 1,
    borderColor: '#bdc8c0',
  },
});
