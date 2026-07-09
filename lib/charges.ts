import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ChargeSettings, ConsumptionFlags } from "@/lib/budget";
import {
  cancelCharge,
  createCharge,
  generateTxid,
  getChargeStatus,
} from "@/lib/pix";

export type PixChargeStatus =
  | "pending"
  | "paid"
  | "expired"
  | "canceled"
  | "refunded";

export type PixCharge = {
  id: string;
  event_id: string;
  user_id: string;
  txid: string;
  psp_charge_id: string | null;
  amount_cents: number;
  brcode: string;
  status: PixChargeStatus;
  paid_at: string | null;
  paid_manually: boolean;
  refunded_at: string | null;
  expires_at: string;
};

const CHARGE_COLUMNS =
  "id, event_id, user_id, txid, psp_charge_id, amount_cents, brcode, status, paid_at, paid_manually, refunded_at, expires_at";

// A charge's amount at creation time (specs/pix-payments.md §4).
export function chargeAmountFor(
  settings: ChargeSettings,
  flags: ConsumptionFlags
): number {
  return (
    settings.base_price_cents -
    (flags.no_alcohol ? settings.no_alcohol_deduction_cents : 0) -
    (flags.no_meat ? settings.no_meat_deduction_cents : 0)
  );
}

// pending → expired happens lazily on read — no cron (specs/pix-payments.md §4).
async function expireStaleCharges(eventId: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("pix_charges")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
  if (error) throw new Error(`Failed to expire charges: ${error.message}`);
}

export type PixChargeWithUser = PixCharge & {
  userName: string | null;
  userEmail: string;
};

// Every charge for the event — live rows plus paid/refunded history, which
// the payment board needs for removed participants and totals
// (specs/pix-payments.md §7.2). Canceled rows stay out; they're pure history.
export async function listEventCharges(
  eventId: string
): Promise<PixChargeWithUser[]> {
  await expireStaleCharges(eventId);
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pix_charges")
    .select(`${CHARGE_COLUMNS}, users!user_id ( name, email )`)
    .eq("event_id", eventId)
    .neq("status", "canceled")
    .order("created_at");
  if (error) throw new Error(`Failed to list charges: ${error.message}`);
  return (data ?? []).map((row) => {
    const { users, ...charge } = row as unknown as PixCharge & {
      users: { name: string | null; email: string };
    };
    return {
      ...charge,
      userName: users?.name ?? null,
      userEmail: users?.email ?? "",
    };
  });
}

// The one live charge (unique partial index) for a user, if any.
export async function getLiveCharge(
  eventId: string,
  userId: string
): Promise<PixCharge | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pix_charges")
    .select(CHARGE_COLUMNS)
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .not("status", "in", "(canceled,refunded)")
    .maybeSingle();
  if (error) throw new Error(`Failed to load charge: ${error.message}`);
  return data as PixCharge | null;
}

// Creates the PSP charge + local row for one user. Callers guarantee the
// user has no live charge (the unique index is the backstop).
export async function createChargeForUser(
  eventId: string,
  user: { id: string; email: string },
  amountCents: number
): Promise<PixCharge> {
  const txid = generateTxid();
  const created = await createCharge({
    txid,
    amountCents,
    payerEmail: user.email,
  });

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pix_charges")
    .insert({
      event_id: eventId,
      user_id: user.id,
      txid,
      psp_charge_id: created.pspChargeId,
      amount_cents: amountCents,
      brcode: created.brcode,
      expires_at: created.expiresAt,
    })
    .select(CHARGE_COLUMNS)
    .single();
  if (error) {
    // The PSP charge exists but the row failed — cancel it so no orphan
    // charge can be paid.
    await cancelCharge(created.pspChargeId);
    throw new Error(`Failed to record charge: ${error.message}`);
  }
  return data as PixCharge;
}

// Webhook fallback (specs/pix-payments.md §5): asks the PSP whether a
// pending charge got paid and records it. Keeps local dev (where webhooks
// can't reach us) and webhook misses from lying forever.
export async function reconcileChargeWithPsp<T extends PixCharge>(
  charge: T
): Promise<T> {
  if (charge.status !== "pending" || !charge.psp_charge_id) return charge;
  const status = await getChargeStatus(charge.psp_charge_id);
  if (!status?.paid) return charge;

  const paidAt = status.paidAt ?? new Date().toISOString();
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("pix_charges")
    .update({ status: "paid", paid_at: paidAt, updated_at: new Date().toISOString() })
    .eq("id", charge.id)
    .eq("status", "pending");
  if (error) throw new Error(`Failed to reconcile charge: ${error.message}`);
  return { ...charge, status: "paid", paid_at: paidAt };
}

// Cancels a charge: PSP-side best-effort, local row always
// (specs/pix-payments.md §4 "pending → canceled").
export async function cancelChargeRow(charge: PixCharge): Promise<void> {
  if (charge.psp_charge_id) await cancelCharge(charge.psp_charge_id);
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("pix_charges")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", charge.id)
    .in("status", ["pending", "expired"]);
  if (error) throw new Error(`Failed to cancel charge: ${error.message}`);
}

// Removal / deactivation helper: cancels the user's live charge unless it's
// paid — money already moved (specs/pix-payments.md §6).
export async function cancelUnpaidLiveCharge(
  eventId: string,
  userId: string
): Promise<void> {
  const charge = await getLiveCharge(eventId, userId);
  if (charge && charge.status !== "paid") await cancelChargeRow(charge);
}

// Settings + the user's flags + email — everything needed to price and
// create a charge for one user. Settings null = charging inactive.
async function loadChargeInputs(eventId: string, userId: string) {
  const supabase = createServerSupabaseClient();
  const [
    { data: settings, error: sError },
    { data: membership, error: mError },
    { data: user, error: uError },
  ] = await Promise.all([
    supabase
      .from("event_charge_settings")
      .select(
        "event_id, base_price_cents, no_alcohol_deduction_cents, no_meat_deduction_cents"
      )
      .eq("event_id", eventId)
      .maybeSingle(),
    supabase
      .from("event_memberships")
      .select("no_alcohol, no_meat")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("users").select("id, email").eq("id", userId).single(),
  ]);
  if (sError || mError || uError) {
    throw new Error(
      `Failed to load charge inputs: ${(sError ?? mError ?? uError)!.message}`
    );
  }
  return {
    settings: settings as ChargeSettings | null,
    user: user as { id: string; email: string },
    flags: {
      no_alcohol: membership?.no_alcohol ?? false,
      no_meat: membership?.no_meat ?? false,
    },
  };
}

// Post-activation approvals get charged automatically at approval time,
// priced by the current settings and their flags (specs/pix-payments.md §6).
// No-op when charging is inactive or the user already has a live (possibly
// paid — re-approval after removal) charge.
export async function ensureChargeForUser(
  eventId: string,
  userId: string
): Promise<void> {
  const { settings, user, flags } = await loadChargeInputs(eventId, userId);
  if (!settings) return;
  if (await getLiveCharge(eventId, userId)) return;
  await createChargeForUser(eventId, user, chargeAmountFor(settings, flags));
}

// Repricing = regeneration (specs/pix-payments.md §9): cancel the unpaid
// charge, create a fresh one (new txid) at the current settings + flags.
export async function regenerateChargeRow(charge: PixCharge): Promise<void> {
  if (charge.status === "paid" || charge.status === "refunded") {
    throw new Error("A paid charge is never regenerated");
  }
  const { settings, user, flags } = await loadChargeInputs(
    charge.event_id,
    charge.user_id
  );
  if (!settings) throw new Error("Charging is not active");
  await cancelChargeRow(charge);
  await createChargeForUser(
    charge.event_id,
    user,
    chargeAmountFor(settings, flags)
  );
}
