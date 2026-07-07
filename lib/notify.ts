import "server-only";
import type { AppUser } from "@/lib/dal";
import type { EventRow } from "@/lib/events";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Emails every admin when someone asks to join an event, via the Resend
// HTTP API (no SDK dependency). Failures are logged, never thrown — a join
// request must not fail just because the notification did.
export async function notifyAdminsOfJoinRequest(
  requester: AppUser,
  event: EventRow
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // email not configured (e.g. local dev)

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("users")
      .select("email")
      .eq("is_admin", true)
      .neq("id", requester.id);
    if (error) throw new Error(error.message);

    const to = (data ?? []).map((u) => u.email as string);
    if (to.length === 0) return;

    const who = requester.name
      ? `${requester.name} (${requester.email})`
      : requester.email;
    const eventUrl = `${process.env.APP_BASE_URL ?? ""}/events/${event.id}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Event Tracker <onboarding@resend.dev>",
        to,
        subject: `Join request: ${event.title}`,
        text: `${who} asked to join "${event.title}".\n\nReview the request: ${eventUrl}`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("Failed to send join-request notification:", err);
  }
}
