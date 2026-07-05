import "server-only";
import { cache } from "react";
import { auth0 } from "@/lib/auth0";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  auth0_sub: string;
  email: string;
  name: string | null;
  is_admin: boolean;
};

// Resolves the Auth0 session and mirrors the identity into the Supabase
// `users` table (specs/spec.md §6). Returns null when logged out. Cached per
// render pass so pages, layouts and actions can all call it freely.
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await auth0.getSession();
  if (!session) return null;

  const { sub, email, name } = session.user;
  const supabase = createServerSupabaseClient();

  // Upsert keyed by auth0_sub; is_admin is intentionally left out so a
  // login never resets a flag that was granted in the database.
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        auth0_sub: sub,
        email: email ?? "",
        name: name ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "auth0_sub" }
    )
    .select("id, auth0_sub, email, name, is_admin")
    .single();

  if (error) {
    throw new Error(`Failed to sync user with Supabase: ${error.message}`);
  }

  return data;
});
