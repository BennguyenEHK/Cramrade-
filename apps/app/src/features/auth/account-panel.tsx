import type { Session } from '@supabase/supabase-js';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';

import { signOut } from './auth-actions';

/** Shown on the sign-in page to a student who is already signed in. */
export function AccountPanel({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = session.user.email ?? 'your account';
  const rawName: unknown = session.user.user_metadata?.display_name;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;

  async function leave() {
    setBusy(true);
    setError(null);
    const result = await signOut();
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  return (
    <View style={styles.panel}>
      <AppText variant="headline">{name ? `Hello, ${name}` : 'You are signed in'}</AppText>
      <AppText tone="inkMuted" testID="signed-in-as">
        Signed in as {email}.
      </AppText>
      <View style={styles.actions}>
        <LinkButton href="/workspace">Go to your workspace</LinkButton>
        <Button variant="quiet" onPress={leave} busy={busy} busyLabel="Signing out">
          Sign out
        </Button>
      </View>
      {error && (
        <AppText role="alert" bold>
          {error}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxWidth: Layout.proseMaxWidth,
    gap: Spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
});
