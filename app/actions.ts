"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import {
  canEnterEvent,
  getEvent,
  getMembership,
  listParticipants,
} from "@/lib/events";
import {
  cancelChargeRow,
  cancelUnpaidLiveCharge,
  chargeAmountFor,
  createChargeForUser,
  ensureChargeForUser,
  getLiveCharge,
  reconcileChargeWithPsp,
  regenerateChargeRow,
  type PixCharge,
} from "@/lib/charges";
import { getChargeSettings } from "@/lib/budget";
import { cancelCharge as cancelPspCharge } from "@/lib/pix";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Namespace } from "@/lib/i18n/config";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// User-facing validation/state errors are thrown in the viewer's language
// (specs/i18n.md §3). The `Failed to X: ${message}` wrappers around DB/PSP
// failures stay in English — they're diagnostics, not UI copy.
async function tError(
  ns: Namespace,
  key: string,
  options?: Record<string, unknown>
) {
  const { t } = await getT(ns);
  return new Error(t(key, options));
}

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw await tError("common", "errors.notLoggedIn");
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (!user.is_admin) throw await tError("common", "errors.adminsOnly");
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

  if (!title) throw await tError("event", "errors.titleRequired");
  if (!DAY_RE.test(windowStart) || !DAY_RE.test(windowEnd)) {
    throw await tError("event", "errors.windowRequired");
  }
  if (windowEnd < windowStart) {
    throw await tError("event", "errors.windowOrder");
  }
  // 6-month cap (specs/spec.md §8); the DB constraint is the backstop.
  const cap = new Date(`${windowStart}T00:00:00Z`);
  cap.setUTCMonth(cap.getUTCMonth() + 6);
  if (new Date(`${windowEnd}T00:00:00Z`) > cap) {
    throw await tError("event", "errors.windowCap");
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
  // PSP-side charges are best-effort canceled before the cascade wipes the
  // local rows (specs/pix-payments.md §6 "Event deletion").
  const { data: liveCharges } = await supabase
    .from("pix_charges")
    .select("psp_charge_id")
    .eq("event_id", eventId)
    .in("status", ["pending", "expired"]);
  for (const charge of liveCharges ?? []) {
    if (charge.psp_charge_id) await cancelPspCharge(charge.psp_charge_id);
  }
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
  if (!DAY_RE.test(day)) throw await tError("event", "errors.invalidDay");

  const event = await getEvent(eventId);
  if (!event) throw await tError("common", "errors.eventNotFound");
  if (event.status === "finalized") {
    throw await tError("event", "errors.alreadyFinalized");
  }
  if (day < event.window_start || day > event.window_end) {
    throw await tError("event", "errors.finalizedOutsideWindow");
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
  if (!event) throw await tError("common", "errors.eventNotFound");
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
    // An auto-approval is an approval: on an event with active charging the
    // new member gets their charge right away (specs/pix-payments.md §6).
    if (event.auto_approve_members) {
      await ensureChargeForUser(eventId, user.id);
    }
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
    .select("event_id, user_id")
    .maybeSingle();
  if (error) throw new Error(`Failed to decide membership: ${error.message}`);
  if (data) {
    // Members approved after activation get their charge created at approval
    // time (specs/pix-payments.md §6). A kept paid charge from a previous
    // stint means no new charge (ensureChargeForUser skips live rows).
    if (decision === "approved") {
      await ensureChargeForUser(data.event_id, data.user_id);
    }
    revalidatePath(`/events/${data.event_id}`);
  }
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
    const { data: approved, error: approveError } = await supabase
      .from("event_memberships")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: null,
      })
      .eq("event_id", eventId)
      .eq("status", "pending")
      .select("user_id");
    if (approveError) {
      throw new Error(
        `Auto-approve is on, but approving the pending requests failed: ${approveError.message}`
      );
    }
    // Approvals on an event with active charging create charges
    // (specs/pix-payments.md §6), no matter how the approval happened.
    for (const row of approved ?? []) {
      await ensureChargeForUser(eventId, row.user_id);
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
  if (!event) throw await tError("common", "errors.eventNotFound");

  const supabase = createServerSupabaseClient();
  const { data: membership, error: mError } = await supabase
    .from("event_memberships")
    .select("id, user_id, status")
    .eq("id", membershipId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (mError) throw new Error(`Failed to load participant: ${mError.message}`);
  if (!membership || membership.status !== "approved") {
    throw await tError("event", "errors.participantNotFound");
  }
  if (membership.user_id === event.created_by) {
    throw await tError("event", "errors.creatorNotRemovable");
  }

  // With active charging, removal cancels an unpaid charge; a paid one is
  // kept — money already moved (specs/pix-payments.md §6).
  await cancelUnpaidLiveCharge(eventId, membership.user_id);

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
  if (!DAY_RE.test(day)) throw await tError("event", "errors.invalidDay");

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

async function parseBudgetItemInput(
  name: unknown,
  amountCents: unknown,
  exemption: unknown
) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw await tError("budget", "errors.nameRequired");
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw await tError("budget", "errors.amountPositive");
  }
  if (!EXEMPTIONS.includes(exemption as (typeof EXEMPTIONS)[number])) {
    throw await tError("budget", "errors.invalidExemption");
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
  if (!event) throw await tError("common", "errors.eventNotFound");

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("budget_items")
    .insert({
      event_id: eventId,
      ...(await parseBudgetItemInput(name, amountCents, exemption)),
    });
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
      ...(await parseBudgetItemInput(name, amountCents, exemption)),
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
  if (!event) throw await tError("common", "errors.eventNotFound");

  const membership = await getMembership(eventId, user.id);
  if (!canEnterEvent(user, event, membership)) {
    throw await tError("common", "errors.noAccess");
  }

  const supabase = createServerSupabaseClient();
  const { data: settings, error: sError } = await supabase
    .from("event_charge_settings")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (sError) throw new Error(`Failed to check charging: ${sError.message}`);
  if (settings) {
    throw await tError("payment", "errors.flagsLocked");
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

// --- Pix charging (specs/pix-payments.md) ------------------------------------

// Loads a charge scoped to the event, or throws — every admin row action
// starts here so a charge id can't be replayed across events.
async function requireEventCharge(
  eventId: string,
  chargeId: string
): Promise<PixCharge> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pix_charges")
    .select(
      "id, event_id, user_id, txid, psp_charge_id, amount_cents, brcode, status, paid_at, paid_manually, refunded_at, expires_at"
    )
    .eq("id", chargeId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load charge: ${error.message}`);
  if (!data) throw await tError("payment", "errors.chargeNotFound");
  return data as PixCharge;
}

// Activation (specs/pix-payments.md §6): snapshots the prices and creates one
// charge per currently approved participant — including the admin themself.
export async function activateCharging(
  eventId: string,
  prices: {
    basePriceCents: number;
    noAlcoholDeductionCents: number;
    noMeatDeductionCents: number;
  }
) {
  await requireAdmin();
  const event = await getEvent(eventId);
  if (!event) throw await tError("common", "errors.eventNotFound");
  if (event.status !== "finalized") {
    throw await tError("payment", "errors.notFinalized");
  }

  const { basePriceCents, noAlcoholDeductionCents, noMeatDeductionCents } =
    prices;
  if (
    !Number.isInteger(basePriceCents) ||
    !Number.isInteger(noAlcoholDeductionCents) ||
    !Number.isInteger(noMeatDeductionCents) ||
    basePriceCents <= 0 ||
    noAlcoholDeductionCents < 0 ||
    noMeatDeductionCents < 0
  ) {
    throw await tError("payment", "errors.pricesPositive");
  }
  // A fully-deducted participant must still owe a positive amount
  // (specs/pix-payments.md §4).
  if (basePriceCents - noAlcoholDeductionCents - noMeatDeductionCents <= 0) {
    throw await tError("payment", "errors.minimumPositive");
  }

  const supabase = createServerSupabaseClient();
  const settings = {
    event_id: eventId,
    base_price_cents: basePriceCents,
    no_alcohol_deduction_cents: noAlcoholDeductionCents,
    no_meat_deduction_cents: noMeatDeductionCents,
  };
  // The insert doubles as the "already active" check (pk on event_id).
  const { error } = await supabase.from("event_charge_settings").insert(settings);
  if (error) throw new Error(`Failed to activate charging: ${error.message}`);

  // One PSP charge per participant. A paid charge kept from a previous
  // activation round means that person isn't charged again (§6).
  const participants = await listParticipants(event);
  const created: PixCharge[] = [];
  try {
    for (const p of participants) {
      if (await getLiveCharge(eventId, p.userId)) continue;
      const amount = chargeAmountFor(settings, {
        no_alcohol: p.noAlcohol,
        no_meat: p.noMeat,
      });
      created.push(
        await createChargeForUser(eventId, { id: p.userId, email: p.email }, amount)
      );
    }
  } catch (cause) {
    // All-or-nothing: unwind the charges already created and the settings so
    // the admin can simply retry.
    for (const charge of created) await cancelChargeRow(charge);
    await supabase.from("event_charge_settings").delete().eq("event_id", eventId);
    throw cause;
  }

  revalidatePath(`/events/${eventId}`);
}

// Deactivation cancels every unpaid charge and deletes the settings; paid
// charges are kept (specs/pix-payments.md §6).
export async function deactivateCharging(eventId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { data: charges, error } = await supabase
    .from("pix_charges")
    .select(
      "id, event_id, user_id, txid, psp_charge_id, amount_cents, brcode, status, paid_at, paid_manually, refunded_at, expires_at"
    )
    .eq("event_id", eventId)
    .in("status", ["pending", "expired"]);
  if (error) throw new Error(`Failed to load charges: ${error.message}`);
  for (const charge of (charges ?? []) as PixCharge[]) {
    await cancelChargeRow(charge);
  }
  const { error: dError } = await supabase
    .from("event_charge_settings")
    .delete()
    .eq("event_id", eventId);
  if (dError) throw new Error(`Failed to deactivate charging: ${dError.message}`);
  revalidatePath(`/events/${eventId}`);
}

// Manual fallback for when the webhook missed or someone paid in cash
// (specs/pix-payments.md §2).
export async function markChargePaid(eventId: string, chargeId: string) {
  await requireAdmin();
  const charge = await requireEventCharge(eventId, chargeId);
  if (charge.status !== "pending" && charge.status !== "expired") {
    throw await tError("payment", "errors.onlyUnpaidPaid");
  }
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("pix_charges")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_manually: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", chargeId)
    .in("status", ["pending", "expired"]);
  if (error) throw new Error(`Failed to mark as paid: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
}

// Bookkeeping for a refund the admin already sent from their bank app —
// the app never moves money (specs/pix-payments.md §9). The amount leaves
// the collected total.
export async function markChargeRefunded(eventId: string, chargeId: string) {
  await requireAdmin();
  const charge = await requireEventCharge(eventId, chargeId);
  if (charge.status !== "paid") {
    throw await tError("payment", "errors.onlyPaidRefunded");
  }
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("pix_charges")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", chargeId)
    .eq("status", "paid");
  if (error) throw new Error(`Failed to mark as refunded: ${error.message}`);
  revalidatePath(`/events/${eventId}`);
}

export async function cancelParticipantCharge(
  eventId: string,
  chargeId: string
) {
  await requireAdmin();
  const charge = await requireEventCharge(eventId, chargeId);
  if (charge.status !== "pending" && charge.status !== "expired") {
    throw await tError("payment", "errors.onlyUnpaidCanceled");
  }
  await cancelChargeRow(charge);
  revalidatePath(`/events/${eventId}`);
}

// Admin regeneration: new txid, repriced by current settings + flags
// (specs/pix-payments.md §7.2).
export async function regenerateParticipantCharge(
  eventId: string,
  chargeId: string
) {
  await requireAdmin();
  const charge = await requireEventCharge(eventId, chargeId);
  await regenerateChargeRow(charge);
  revalidatePath(`/events/${eventId}`);
}

// A participant regenerates their own expired charge (specs/pix-payments.md §7.1).
export async function regenerateMyCharge(eventId: string) {
  const user = await requireUser();
  const charge = await getLiveCharge(eventId, user.id);
  if (!charge) throw await tError("payment", "errors.noCharge");
  if (charge.status !== "expired") {
    throw await tError("payment", "errors.onlyExpiredRegenerated");
  }
  await regenerateChargeRow(charge);
  revalidatePath(`/events/${eventId}`);
}

// Webhook fallback (specs/pix-payments.md §5): checks every pending charge
// against the PSP and records the ones that got paid.
export async function syncChargeStatuses(eventId: string) {
  await requireAdmin();
  const supabase = createServerSupabaseClient();
  const { data: charges, error } = await supabase
    .from("pix_charges")
    .select(
      "id, event_id, user_id, txid, psp_charge_id, amount_cents, brcode, status, paid_at, paid_manually, refunded_at, expires_at"
    )
    .eq("event_id", eventId)
    .eq("status", "pending");
  if (error) throw new Error(`Failed to load charges: ${error.message}`);
  for (const charge of (charges ?? []) as PixCharge[]) {
    await reconcileChargeWithPsp(charge);
  }
  revalidatePath(`/events/${eventId}`);
}

// Admin edit of anyone's flags after activation (specs/pix-payments.md §3):
// regenerates the participant's unpaid charge; a paid charge is never touched.
export async function adminSetConsumptionFlags(
  eventId: string,
  userId: string,
  flags: { noAlcohol: boolean; noMeat: boolean }
) {
  await requireAdmin();
  const event = await getEvent(eventId);
  if (!event) throw await tError("common", "errors.eventNotFound");

  const supabase = createServerSupabaseClient();
  const membership = await getMembership(eventId, userId);
  const values = { no_alcohol: flags.noAlcohol, no_meat: flags.noMeat };
  if (membership) {
    const { error } = await supabase
      .from("event_memberships")
      .update(values)
      .eq("id", membership.id);
    if (error) throw new Error(`Failed to save flags: ${error.message}`);
  } else if (userId === event.created_by) {
    // Same materialization as setConsumptionFlags: the creator's flags live
    // on a membership row created on first write.
    const now = new Date().toISOString();
    const { error } = await supabase.from("event_memberships").insert({
      event_id: eventId,
      user_id: userId,
      status: "approved",
      requested_at: now,
      decided_at: now,
      ...values,
    });
    if (error) throw new Error(`Failed to save flags: ${error.message}`);
  } else {
    throw await tError("event", "errors.participantNotFound");
  }

  const settings = await getChargeSettings(eventId);
  if (settings) {
    const charge = await getLiveCharge(eventId, userId);
    if (charge && charge.status !== "paid") {
      await regenerateChargeRow(charge);
    }
  }
  revalidatePath(`/events/${eventId}`);
}

// --- availability ----------------------------------------------------------

export async function toggleAvailability(eventId: string, day: string) {
  const user = await requireUser();
  if (!DAY_RE.test(day)) throw await tError("event", "errors.invalidDay");

  const event = await getEvent(eventId);
  if (!event) throw await tError("common", "errors.eventNotFound");
  if (event.status !== "open") {
    throw await tError("event", "errors.votingClosed");
  }

  const membership = await getMembership(eventId, user.id);
  if (!canEnterEvent(user, event, membership)) {
    throw await tError("common", "errors.noAccess");
  }
  if (day < event.window_start || day > event.window_end) {
    throw await tError("event", "errors.outsideWindow");
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
