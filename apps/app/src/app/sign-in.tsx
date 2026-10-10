import { useLocalSearchParams } from 'expo-router';

import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Section } from '@/components/frame/section';
import { AppText } from '@/components/ui/text';
import { AccountPanel } from '@/features/auth/account-panel';
import { AuthForm } from '@/features/auth/auth-form';
import { useAuth } from '@/features/auth/auth-provider';
import { isSupabaseConfigured } from '@/lib/supabase-config';

/**
 * Sign in or create an account (task B2). Open with ?mode=create to start on
 * the create-account form. A student who is already signed in sees their
 * account and a sign-out button instead.
 */
export default function SignInScreen() {
  const { session, loading } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();

  return (
    <Page>
      <PageHead title="Sign in" />
      <Section>
        {!isSupabaseConfigured ? (
          <AppText role="alert">
            Sign-in is not connected yet. This copy of the app is missing its Supabase settings.
            Copy apps/app/.env.example to apps/app/.env and fill in the two values.
          </AppText>
        ) : loading ? (
          <AppText tone="inkMuted">Checking whether you are signed in.</AppText>
        ) : session ? (
          <AccountPanel session={session} />
        ) : (
          <AuthForm initialMode={mode === 'create' ? 'create' : 'sign-in'} />
        )}
      </Section>
    </Page>
  );
}
