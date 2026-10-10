import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase-config';

type AuthState = {
  /** The signed-in session, or null when signed out. */
  session: Session | null;
  /** True until the saved session has been read. Screens wait for this. */
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, loading: true });

/**
 * Holds the current sign-in for the whole app. Reads the saved session once,
 * then follows every sign-in, sign-out and token refresh from Supabase.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    loading: isSupabaseConfigured,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false });
    });

    // Do not call other Supabase functions inside this callback (Supabase docs).
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** The current sign-in: `{ session, loading }`. */
export function useAuth() {
  return useContext(AuthContext);
}
