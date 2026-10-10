import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { DISPLAY_NAME_MAX, PASSWORD_MIN, signIn, signUp } from './auth-actions';

export type AuthMode = 'sign-in' | 'create';

type Message = { kind: 'error' | 'info'; text: string };

/** Sign in, or create an account, with email and password. */
export function AuthForm({ initialMode = 'sign-in' }: { initialMode?: AuthMode }) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const creating = mode === 'create';

  function switchMode() {
    setMode(creating ? 'sign-in' : 'create');
    setMessage(null);
  }

  function problemWithInput(): string | null {
    if (!email.trim().includes('@')) return 'Enter your email address.';
    if (!password) return 'Enter your password.';
    if (creating && password.length < PASSWORD_MIN) {
      return `Use at least ${PASSWORD_MIN} characters for your password.`;
    }
    return null;
  }

  async function submit() {
    if (busy) return;
    const problem = problemWithInput();
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }

    setBusy(true);
    setMessage(null);
    const result = creating ? await signUp(name, email, password) : await signIn(email, password);
    setBusy(false);

    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return;
    }
    if (result.signedIn) {
      router.replace('/workspace');
      return;
    }
    // The live project asks new accounts to confirm their email first.
    setMode('sign-in');
    setPassword('');
    setMessage({
      kind: 'info',
      text: `Check your email. We sent a link to ${email.trim()}. Open it to finish creating your account.`,
    });
  }

  return (
    <View style={styles.form}>
      <View style={styles.copy}>
        <AppText variant="headline">{creating ? 'Create your account' : 'Sign in'}</AppText>
        <AppText tone="inkMuted">
          {creating
            ? 'One account works in the browser and, later, on your phone.'
            : 'Welcome back. Your plan is where you left it.'}
        </AppText>
      </View>

      {creating && (
        <TextField
          label="Your name"
          hint="Shown to your study group. You can leave it empty."
          value={name}
          onChangeText={setName}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
      )}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
      />
      <TextField
        label="Password"
        hint={creating ? `At least ${PASSWORD_MIN} characters.` : undefined}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={creating ? 'new-password' : 'current-password'}
        textContentType={creating ? 'newPassword' : 'password'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {message && (
        <View
          role={message.kind === 'error' ? 'alert' : 'status'}
          style={[
            styles.message,
            {
              borderColor: message.kind === 'error' ? colors.ink : colors.session,
              backgroundColor: message.kind === 'error' ? colors.surface : colors.sessionSoft,
            },
          ]}>
          <AppText bold={message.kind === 'error'}>{message.text}</AppText>
        </View>
      )}

      <Button
        onPress={submit}
        busy={busy}
        busyLabel={creating ? 'Creating your account' : 'Signing in'}>
        {creating ? 'Create account' : 'Sign in'}
      </Button>

      <View style={styles.switchRow}>
        <AppText tone="inkMuted">{creating ? 'Already have an account?' : 'New to Cramrade?'}</AppText>
        <Pressable role="button" onPress={switchMode} hitSlop={8}>
          <AppText tone="session" bold>
            {creating ? 'Sign in' : 'Create an account'}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    maxWidth: 420,
    width: '100%',
    gap: Spacing.lg,
  },
  copy: {
    gap: Spacing.xs,
  },
  message: {
    padding: Spacing.md,
    borderWidth: 1.5,
    borderRadius: Radius.control,
  },
  switchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
