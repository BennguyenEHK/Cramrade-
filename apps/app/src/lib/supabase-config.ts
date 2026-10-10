/**
 * The two public Supabase values, from apps/app/.env (see .env.example).
 * Expo copies EXPO_PUBLIC_ values into the app when it is built, so they must
 * be read exactly like this, one name at a time.
 *
 * When they are missing the app still runs, so the homepage works on a fresh
 * clone. Sign-in then tells the student it is not connected instead of crashing.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = url.length > 0 && publishableKey.length > 0;

export const supabaseConfig = {
  url: isSupabaseConfigured ? url : 'http://localhost:54321',
  publishableKey: isSupabaseConfigured ? publishableKey : 'not-configured',
};
