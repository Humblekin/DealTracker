import { useState, useEffect } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import toast from 'react-hot-toast';
import { AuthContext } from '../hooks/useAuth';

const MAX_CLOCK_SKEW_MS = 120 * 1000; // 2 minutes

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setUser(session?.user ?? null);
        if (session?.user) fetchProfile(session.user);
        else setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        if (session?.user) fetchProfile(session.user);
        else {
          setProfile(null);
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // A device clock that is more than ~90s off from Supabase's servers makes every
  // access token look expired, causing endless token refreshes, rate-limit (429)
  // failures, and instant logouts. Surface it so it isn't a silent failure.
  useEffect(() => {
    const checkClockSkew = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const serverTime = Date.parse(res.headers.get('date') || '');
        if (!serverTime) return;
        const skewMs = Math.abs(Date.now() - serverTime);
        if (skewMs > MAX_CLOCK_SKEW_MS) {
          const minutes = Math.round(skewMs / 60000);
          toast.warning(
            `Your device clock is ${minutes} minutes off. This causes sign-in and session failures. Please sync your system clock, then reload.`
          );
        }
      } catch { /* ignore */ }
    };
    checkClockSkew();
  }, []);

  useEffect(() => {
    if (!user) return;

    let timeoutId = setTimeout(() => {
      toast.error('Session expired due to inactivity');
      signOut();
    }, INACTIVITY_TIMEOUT);

    const handleActivity = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        toast.error('Session expired due to inactivity');
        signOut();
      }, INACTIVITY_TIMEOUT);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'];
    events.forEach(event => document.addEventListener(event, handleActivity));

    return () => {
      clearTimeout(timeoutId);
      events.forEach(event => document.removeEventListener(event, handleActivity));
    };
  }, [user]);

  async function fetchProfile(authUser) {
    const userId = authUser?.id;
    if (!userId) return;

    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).limit(1).maybeSingle();

      // .single() errors with PGRST116 for BOTH missing AND duplicate rows, which
      // made profiles appear broken. .limit(1).maybeSingle() is safe for both.

      if (error && error.code !== 'PGRST116') throw error;

      // Profile row missing (e.g. account predates the auto-create trigger) — try to create it.
      if (!data) {
        const { error: insertError } = await supabase.from('profiles').upsert(
          {
            id: userId,
            full_name: authUser?.user_metadata?.full_name || authUser?.email?.split('@')[0] || 'User',
            email: authUser?.email || null,
            role: 'buyer',
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        if (insertError) throw insertError;

        const { data: fresh, error: refetchError } = await supabase.from('profiles').select('*').eq('id', userId).limit(1).maybeSingle();
        if (refetchError) throw refetchError;
        if (fresh) {
          setProfile(fresh);
          return;
        }
      }

      if (data) setProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
      toast.error('Failed to load profile. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }

  async function signUp({ email, password, fullName }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) throw error;

    // Profile is created automatically via DB trigger
    return data;
  }

  async function signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session?.access_token) {
      throw new Error('No active session')
    }
    return data.session.access_token
  }

  async function signOut() {
    setUser(null);
    setProfile(null);
    try {
      // Let the client clear its own storage and notify other tabs via
      // BroadcastChannel. Wiping localStorage first can desync that flow.
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') && key.endsWith('auth-token')) {
          localStorage.removeItem(key);
        }
      });
    }
  }

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    getAccessToken,
    refreshProfile: () => user && fetchProfile(user),
    isAdmin: profile?.role === 'admin',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
