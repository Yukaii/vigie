import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseClient(supabaseUrl: string, supabaseKey: string): SupabaseClient {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL and Anon Key must be provided.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

// Optional: Define a type for the Supabase client if needed elsewhere
export type DbClient = SupabaseClient;
