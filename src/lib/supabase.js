import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const SUPABASE_URL = supabaseUrl || 'https://placeholder.supabase.co';
export const SUPABASE_ANON_KEY = supabaseAnonKey || 'placeholder-key';

// Create the client exactly ONCE per page load and reuse it forever.
// In Vite dev, HMR can re-execute this module; without this guard every
// re-execution constructs a new GoTrueClient, and each one independently
// refreshes the same token — racing each other into rate-limit (429) failures
// and random logouts. Reusing the existing instance eliminates that entirely.
const globalKey = '__dealguider_supabase_client';
const globalRef = globalThis;
if (!globalRef[globalKey]) {
  globalRef[globalKey] = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-key',
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    }
  );
}

export const supabase = globalRef[globalKey];
