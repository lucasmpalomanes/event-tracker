import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key. Never import this from a
// Client Component — see spec.md §6 (no RLS; every access path is a
// server action / route handler that checks auth itself).
export function createServerSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables"
    );
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
