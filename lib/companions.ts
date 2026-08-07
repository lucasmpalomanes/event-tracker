import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ConsumptionFlags } from "@/lib/budget";

// A guest without an account, attached to the participant who brought them
// and who pays for them (specs/companions.md §4).
export type Companion = {
  id: string;
  event_id: string;
  host_user_id: string;
  name: string;
  no_alcohol: boolean;
  no_meat: boolean;
};

// Server-layer guard rails, deliberately not SQL constraints
// (specs/companions.md §4).
export const MAX_COMPANIONS_PER_HOST = 10;
export const MAX_COMPANION_NAME_LENGTH = 60;

export async function listEventCompanions(
  eventId: string
): Promise<Companion[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("event_companions")
    .select("id, event_id, host_user_id, name, no_alcohol, no_meat")
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw new Error(`Failed to list companions: ${error.message}`);
  return (data ?? []) as Companion[];
}

// One host's companions, in listing order.
export function companionsOf(
  companions: Companion[],
  hostUserId: string
): Companion[] {
  return companions.filter((c) => c.host_user_id === hostUserId);
}

// One host's companion flags, ready to append to a shares computation or
// price a charge (specs/companions.md §5–6).
export function companionFlagsOf(
  companions: Companion[],
  hostUserId: string
): ConsumptionFlags[] {
  return companionsOf(companions, hostUserId).map((c) => ({
    no_alcohol: c.no_alcohol,
    no_meat: c.no_meat,
  }));
}
