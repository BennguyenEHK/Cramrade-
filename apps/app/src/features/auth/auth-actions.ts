import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type AuthResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; message: string };

/** Longest display name the profiles table accepts. */
export const DISPLAY_NAME_MAX = 60;
/** Supabase's default shortest password. The server has the final say. */
export const PASSWORD_MIN = 6;

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, message: explain(error) };
  return { ok: true, signedIn: true };
}

/**
 * Creates the account. The database makes the profile row by itself and fills
 * display_name from the metadata sent here. When the live project asks for
 * email confirmation there is no session yet, so `signedIn` is false.
 */
export async function signUp(
  displayName: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const name = displayName.trim();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: name ? { display_name: name } : undefined,
      emailRedirectTo:
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}/workspace`
          : undefined,
    },
  });
  if (error) return { ok: false, message: explain(error) };
  return { ok: true, signedIn: data.session !== null };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, message: explain(error) };
  return { ok: true, signedIn: false };
}

/** Plain-words messages for the errors a student can actually cause. */
function explain(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'That email and password do not match an account. Check them and try again.';
    case 'email_not_confirmed':
      return 'Open the link in the email we sent you first, then sign in.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.';
    case 'weak_password':
      return 'Choose a longer password, with letters and numbers.';
    case 'email_address_invalid':
      return 'That email address does not look right.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many tries in a short time. Wait a minute and try again.';
    case 'signup_disabled':
      return 'New accounts are closed right now.';
  }
  if (isAuthRetryableFetchError(error)) {
    return 'Cramrade could not reach the server. Check your internet connection and try again.';
  }
  return error.message || 'Something went wrong. Try again.';
}
