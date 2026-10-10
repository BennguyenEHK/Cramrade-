import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { supabaseConfig } from '@/lib/supabase-config';

/**
 * The Supabase client on Android and iPhone. The web version is supabase.web.ts.
 * The session is kept in expo-sqlite's localStorage, so the student stays
 * signed in after closing the app.
 */
export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// On a phone, only refresh the session while the app is on screen.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
