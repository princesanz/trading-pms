import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Auth state for the whole app.
 *
 * IMPORTANT: `isAdmin` here is UX only — it decides which controls render. The
 * REAL security boundary is Postgres RLS (admin policies tied to the admin UID).
 * Hiding a button never protects the database; RLS does.
 *
 * `isAdmin` = there is a logged-in session AND its user id matches
 * VITE_ADMIN_UID. If VITE_ADMIN_UID is not set yet (placeholder), any logged-in
 * user is treated as admin — safe in Phase 1 because sign-ups are disabled and
 * only the admin account exists. Set VITE_ADMIN_UID to lock the UI to one UID.
 */

const ADMIN_UID = (import.meta.env.VITE_ADMIN_UID as string | undefined)?.trim() || '';

type AuthContextValue = {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    console.log('[AuthProvider] mounted, calling getSession()');
    supabase.auth.getSession().then(({ data }) => {
      console.log('[AuthProvider] getSession() resolved, active:', active, 'session:', !!data.session);
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      console.log('[AuthProvider] setLoading(false) called');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      console.log('[AuthProvider] onAuthStateChange event:', _event, 'session:', !!s);
      setSession(s);
    });
    return () => {
      console.log('[AuthProvider] unmounting');
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAdmin = !!session?.user && (ADMIN_UID === '' || session.user.id === ADMIN_UID);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, isAdmin, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
