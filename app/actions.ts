"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { canEnterEvent, getEvent, getMembership } from "@/lib/events";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (!user.is_admin) throw new Error("Admins only");
  return user;
}

// --- events (admin) --------------------------------------------------------

export async function createEvent(formData: FormData) {
  const user = await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const windowStart = String(formData.get("window_start") ?? "");
  const windowEnd = String(formData.get("window_end") ?? "");

  if (!title) throw new Error("Title is required");
  if (!DAY_RE.test(windowStart) || !DAY_RE.test(windowEnd)) {
    throw new Error("Both window dates are required");
  }
  if (windowEnd < windowStart) {
    throw new Error("Window end must not be before window start");
  }
  // 6-month cap (specs/spec.md §8); the DB constraint is the backstop.
  const cap = new Date(`${windowStart}T00:00:00Z`);
  cap.setUTCMonth(cap.getUTCMonth() + 6);
  if (new Date(`${windowEnd}T00:00:00Z`) > cap) {
    throw new Error("The date window may span at most 6 months");
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      created_by: user.id,
      title,
      description: description || null,
      location: location || null,
      window_start: windowStart,
      window_end: windowEnd,
      auto_approve_members: formData.get("auto_approve_members") === "on",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create event: ${error.message}`);

  revalidatePath("/");
  redirect(`/events/${data.id}`);
}

export async function updateEventDetails(eventId: string, formData: FormData) {
  await requireAdmin();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("events")
    .update({
      description: description || null,
      location: location || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) throw new Error(`Failed to update event: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

export async function deleteEvent(eventId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  // Memberships and availabilities go with it (on delete cascade).
  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) throw new Error(`Failed to delete event: ${error.message}`);
  revalidatePath("/");
  redirect("/");
}

export async function closeVoting(eventId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("events")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "open");
  if (error) throw new Error(`Failed to close voting: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

export async function reopenVoting(eventId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  // Only closed events can be reopened; finalized stays final (specs/spec.md §8).
  const { error } = await supabase
    .from("events")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "closed");
  if (error) throw new Error(`Failed to reopen voting: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

export async function finalizeEvent(eventId: string, day: string) {
  await requireAdmin();
  if (!DAY_RE.test(day)) throw new Error("Invalid day");

  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");
  if (event.status === "finalized") throw new Error("Already finalized");
  if (day < event.window_start || day > event.window_end) {
    throw new Error("Finalized date must be inside the event window");
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("events")
    .update({
      status: "finalized",
      finalized_date: day,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) throw new Error(`Failed to finalize: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

// --- memberships -----------------------------------------------------------

export async function requestAccess(eventId: string) {
  const user = await requireUser();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");
  const existing = await getMembership(eventId, user.id);

  const supabase = createServerSupabaseClient();
  if (!existing) {
    // With auto-approve on, a first-time request is approved on the spot.
    // decided_by stays null — that's how auto-approvals are recorded
    // (specs/spec.md §4). A rejected user's re-request below is NOT auto-approved:
    // a rejection is an explicit admin decision.
    const now = new Date().toISOString();
    const { error } = await supabase.from("event_memberships").insert(
      event.auto_approve_members
        ? {
            event_id: eventId,
            user_id: user.id,
            status: "approved",
            requested_at: now,
            decided_at: now,
          }
        : { event_id: eventId, user_id: user.id }
    );
    if (error) throw new Error(`Failed to request access: ${error.message}`);
  } else if (existing.status === "rejected") {
    // Re-requesting flips the row back to pending (specs/spec.md §4).
    const { error } = await supabase
      .from("event_memberships")
      .update({
        status: "pending",
        requested_at: new Date().toISOString(),
        decided_at: null,
        decided_by: null,
      })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to re-request access: ${error.message}`);
  }
  revalidatePath("/");
}

export async function decideMembership(
  membershipId: string,
  decision: "approved" | "rejected"
) {
  const admin = await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("event_memberships")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: admin.id,
    })
    .eq("id", membershipId)
    .eq("status", "pending")
    .select("event_id")
    .maybeSingle();
  if (error) throw new Error(`Failed to decide membership: ${error.message}`);
  if (data) revalidatePath(`/events/${data.event_id}`);
  revalidatePath("/");
}

export async function setAutoApprove(eventId: string, enabled: boolean) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();

  const { error } = await supabase
    .from("events")
    .update({
      auto_approve_members: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) throw new Error(`Failed to update auto-approve: ${error.message}`);

  // Turning the flag on also approves everything currently pending,
  // recorded as auto-approvals (decided_by = null, specs/spec.md §4).
  if (enabled) {
    const { error: approveError } = await supabase
      .from("event_memberships")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: null,
      })
      .eq("event_id", eventId)
      .eq("status", "pending");
    if (approveError) {
      throw new Error(
        `Auto-approve is on, but approving the pending requests failed: ${approveError.message}`
      );
    }
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

// --- participant & vote removal (specs/spec.md §5.3) ------------------------------

// Removal is allowed on any event status, including finalized (revised
// 2026-07-08) — people can change their mind about attending.

export async function removeParticipant(eventId: string, membershipId: string) {
  await requireAdmin();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");

  const supabase = createServerSupabaseClient();
  const { data: membership, error: mError } = await supabase
    .from("event_memberships")
    .select("id, user_id, status")
    .eq("id", membershipId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (mError) throw new Error(`Failed to load participant: ${mError.message}`);
  if (!membership || membership.status !== "approved") {
    throw new Error("Participant not found");
  }
  if (membership.user_id === event.created_by) {
    throw new Error("The event's creator cannot be removed");
  }

  // Membership deletion does not cascade to votes (specs/spec.md §4) — two
  // explicit deletes, votes first so a failure never strands orphan votes.
  const { error: vError } = await supabase
    .from("availabilities")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", membership.user_id);
  if (vError) {
    throw new Error(`Failed to remove participant's votes: ${vError.message}`);
  }
  const { error } = await supabase
    .from("event_memberships")
    .delete()
    .eq("id", membershipId);
  if (error) throw new Error(`Failed to remove participant: ${error.message}`);

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

export async function clearUserVotes(eventId: string, userId: string) {
  await requireAdmin();

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("availabilities")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to clear votes: ${error.message}`);

  revalidatePath(`/events/${eventId}`);
}

export async function removeSingleVote(
  eventId: string,
  userId: string,
  day: string
) {
  await requireAdmin();
  if (!DAY_RE.test(day)) throw new Error("Invalid day");

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("availabilities")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("day", day);
  if (error) throw new Error(`Failed to remove vote: ${error.message}`);

  revalidatePath(`/events/${eventId}`);
}

// --- budget (specs/event-budget.md) -----------------------------------------

const EXEMPTIONS = ["none", "alcohol", "meat"] as const;

function parseBudgetItemInput(name: unknown, amountCents: unknown, exemption: unknown) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Item name is required");
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Item amount must be a positive value");
  }
  if (!EXEMPTIONS.includes(exemption as (typeof EXEMPTIONS)[number])) {
    throw new Error("Invalid exemption group");
  }
  return { name: trimmed, amount_cents: cents, exemption: exemption as string };
}

export async function addBudgetItem(
  eventId: string,
  name: string,
  amountCents: number,
  exemption: string
) {
  await requireAdmin();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("budget_items")
    .insert({ event_id: eventId, ...parseBudgetItemInput(name, amountCents, exemption) });
  if (error) throw new Error(`Failed to add budget item: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
}

export async function updateBudgetItem(
  eventId: string,
  itemId: string,
  name: string,
  amountCents: number,
  exemption: string
) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("budget_items")
    .update({
      ...parseBudgetItemInput(name, amountCents, exemption),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("event_id", eventId);
  if (error) throw new Error(`Failed to update budget item: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteBudgetItem(eventId: string, itemId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("budget_items")
    .delete()
    .eq("id", itemId)
    .eq("event_id", eventId);
  if (error) throw new Error(`Failed to delete budget item: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
}

// A participant sets their own flags, allowed at any event status until
// charging is activated (specs/pix-payments.md §4, specs/event-budget.md §6.2).
export async function setConsumptionFlags(
  eventId: string,
  flags: { noAlcohol: boolean; noMeat: boolean }
) {
  const user = await requireUser();
  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");

  const membership = await getMembership(eventId, user.id);
  if (!canEnterEvent(user, event, membership)) {
    throw new Error("You don't have access to this event");
  }

  const supabase = createServerSupabaseClient();
  const { data: settings, error: sError } = await supabase
    .from("event_charge_settings")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (sError) throw new Error(`Failed to check charging: ${sError.message}`);
  if (settings) {
    throw new Error("Charging is active — ask the admin to change your flags");
  }

  const values = {
    no_alcohol: flags.noAlcohol,
    no_meat: flags.noMeat,
  };
  if (membership) {
    const { error } = await supabase
      .from("event_memberships")
      .update(values)
      .eq("id", membership.id);
    if (error) throw new Error(`Failed to save flags: ${error.message}`);
  } else {
    // The creator (or an admin) enters without a membership row; flags live
    // on event_memberships, so materialize their implicit approval.
    const now = new Date().toISOString();
    const { error } = await supabase.from("event_memberships").insert({
      event_id: eventId,
      user_id: user.id,
      status: "approved",
      requested_at: now,
      decided_at: now,
      ...values,
    });
    if (error) throw new Error(`Failed to save flags: ${error.message}`);
  }
  revalidatePath(`/events/${eventId}`);
}

// --- availability ----------------------------------------------------------

export async function toggleAvailability(eventId: string, day: string) {
  const user = await requireUser();
  if (!DAY_RE.test(day)) throw new Error("Invalid day");

  const event = await getEvent(eventId);
  if (!event) throw new Error("Event not found");
  if (event.status !== "open") throw new Error("Voting is closed");

  const membership = await getMembership(eventId, user.id);
  if (!canEnterEvent(user, event, membership)) {
    throw new Error("You don't have access to this event");
  }
  if (day < event.window_start || day > event.window_end) {
    throw new Error("Day is outside the event window");
  }

  const supabase = createServerSupabaseClient();
  const { data: existing, error: readError } = await supabase
    .from("availabilities")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .eq("day", day)
    .maybeSingle();
  if (readError) throw new Error(`Failed to toggle: ${readError.message}`);

  if (existing) {
    const { error } = await supabase
      .from("availabilities")
      .delete()
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to unmark day: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("availabilities")
      .insert({ event_id: eventId, user_id: user.id, day });
    if (error) throw new Error(`Failed to mark day: ${error.message}`);
  }
  revalidatePath(`/events/${eventId}`);
}
