import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Shared browser client. The key here is the publishable anon key, which is
 * meant to be public; row level security is what actually protects the data.
 *
 * The build fails when either variable is missing (see vite.config.ts), so the
 * non-null assertions below cannot fire in a real build. They exist only to
 * keep the types honest.
 */
export const supabase = createClient(url!, key!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const isSupabaseConfigured = Boolean(url && key);
