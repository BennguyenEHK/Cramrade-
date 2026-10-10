import { createClient } from '@supabase/supabase-js';

import { supabaseConfig } from '@/lib/supabase-config';

/**
 * The Supabase client in the browser. The phone version is supabase.ts.
 *
 * The web app is also rendered once at build time (static rendering), where
 * there is no browser and no localStorage. There the client keeps nothing.
 * In the browser it keeps the session in localStorage, so the student stays
 * signed in after closing the tab, and it reads the sign-in link from the
 * address when they come back from a confirmation email.
 */
const inBrowser = typeof window !== 'undefined';

export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
  auth: {
    persistSession: inBrowser,
    autoRefreshToken: inBrowser,
    detectSessionInUrl: inBrowser,
  },
});
