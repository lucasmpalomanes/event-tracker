import { revalidatePath } from "next/cache";
import { getChargeStatus, verifyWebhook } from "@/lib/pix";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Mercado Pago order webhook (specs/pix-payments.md §5). This is the one
// path that doesn't go through Auth0 — it authenticates the PSP via the
// x-signature HMAC instead. MP retries until it gets a 2xx, so anything we
// can't act on (unknown order, stale local state) is acknowledged and logged
// rather than errored.
export async function POST(request: Request) {
  const verified = verifyWebhook(request);
  if (!verified) {
    console.warn("Pix webhook: rejected call with invalid x-signature");
    return new Response("invalid signature", { status: 401 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("type") !== "order") {
    return new Response("ignored", { status: 200 });
  }

  const supabase = createServerSupabaseClient();
  const { data: charge, error } = await supabase
    .from("pix_charges")
    .select("id, event_id, status, txid")
    .eq("psp_charge_id", verified.orderId)
    .maybeSingle();
  if (error) {
    console.error(`Pix webhook: charge lookup failed: ${error.message}`);
    return new Response("lookup failed", { status: 500 });
  }
  if (!charge) {
    console.warn(`Pix webhook: unknown order ${verified.orderId}, ignoring`);
    return new Response("unknown order", { status: 200 });
  }
  if (charge.status === "paid" || charge.status === "refunded") {
    return new Response("already settled", { status: 200 });
  }

  // The notification only says "something changed" — the payment's truth
  // comes from querying the order back (MP's recommended flow).
  const status = await getChargeStatus(verified.orderId);
  if (!status?.paid) {
    return new Response("not paid yet", { status: 200 });
  }

  if (charge.status !== "pending") {
    // Locally expired/canceled but the money arrived — local state was
    // stale; mark it paid and surface for admin attention
    // (specs/pix-payments.md §5).
    console.warn(
      `Pix webhook: charge ${charge.txid} was ${charge.status} locally but got paid — marking paid`
    );
  }

  const { error: uError } = await supabase
    .from("pix_charges")
    .update({
      status: "paid",
      paid_at: status.paidAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", charge.id);
  if (uError) {
    // Likely the one-live-charge index (a canceled charge got paid after
    // regeneration). Retrying won't fix it — ack and leave it to the admin.
    console.error(
      `Pix webhook: failed to mark ${charge.txid} paid: ${uError.message}`
    );
    return new Response("not applied", { status: 200 });
  }

  revalidatePath(`/events/${charge.event_id}`);
  return new Response("ok", { status: 200 });
}
