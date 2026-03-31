// src/integrations/supabase/client.ts
// Improved singleton client for MCR Ledger
// DO NOT let Lovable overwrite this — we control it now.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env file.'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // Helps with reliability in React apps
  realtime: {
    params: {
      eventsPerSecond: 5, // Conservative for small team
    },
  },
});

// Optional: Export a typed helper if needed later
export type SupabaseClient = typeof supabase;
