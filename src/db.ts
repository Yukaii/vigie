import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL and Anon Key must be provided in environment variables.");
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// Optional: Define a type for the Supabase client if needed elsewhere
export type DbClient = SupabaseClient;
