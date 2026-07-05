import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/dal";

export type EventStatus = "open" | "closed" | "finalized";
export type MembershipStatus = "pending" | "approved" | "rejected";

export type EventRow = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  location: string | null;
  window_start: string;
  window_end: string;
  status: EventStatus;
  finalized_date: string | null;
  auto_approve_members: boolean;
};

export type MembershipRow = {
  id: string;
  event_id: string;
  user_id: string;
  status: MembershipStatus;
};

export type EventListItem = EventRow & {
  membership: MembershipStatus | null;
  pendingCount: number; // only populated for admins
};

// Whether this user may enter the event's date page (specs/spec.md §3):
// approved membership, event creator, or any admin.
export function canEnterEvent(
  user: AppUser,
  event: EventRow,
  membership: MembershipRow | null
): boolean {
  return (
    user.is_admin ||
    event.created_by === user.id ||
    membership?.status === "approved"
  );
}

// All events with the viewer's membership state; pending request counts
// are included for admins (specs/spec.md §5.1).
export async function listEvents(user: AppUser): Promise<EventListItem[]> {
  const supabase = createServerSupabaseClient();

  const [{ data: events, error }, { data: memberships, error: mError }] =
    await Promise.all([
      supabase
        .from("events")
        .select(
          "id, created_by, title, description, location, window_start, window_end, status, finalized_date, auto_approve_members"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("event_memberships")
        .select("id, event_id, user_id, status"),
    ]);

  if (error || mError) {
    throw new Error(`Failed to list events: ${(error ?? mError)!.message}`);
  }

  return (events as EventRow[]).map((event) => {
    const rows = (memberships as MembershipRow[]).filter(
      (m) => m.event_id === event.id
    );
    const mine = rows.find((m) => m.user_id === user.id);
    return {
      ...event,
      membership: mine?.status ?? null,
      pendingCount: user.is_admin
        ? rows.filter((m) => m.status === "pending").length
        : 0,
    };
  });
}

export async function getEvent(eventId: string): Promise<EventRow | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, created_by, title, description, location, window_start, window_end, status, finalized_date, auto_approve_members"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load event: ${error.message}`);
  return data as EventRow | null;
}

export async function getMembership(
  eventId: string,
  userId: string
): Promise<MembershipRow | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("event_memberships")
    .select("id, event_id, user_id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load membership: ${error.message}`);
  return data as MembershipRow | null;
}

export type PendingRequest = {
  id: string;
  user: { name: string | null; email: string };
};

export async function listPendingRequests(
  eventId: string
): Promise<PendingRequest[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("event_memberships")
    // event_memberships has two FKs to users (user_id, decided_by);
    // the !user_id hint tells PostgREST which one to embed through.
    .select("id, users!user_id ( name, email )")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .order("requested_at");
  if (error) {
    throw new Error(`Failed to list pending requests: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    user: row.users as unknown as PendingRequest["user"],
  }));
}

export type Participant = {
  membershipId: string | null; // null for the implicitly-approved creator
  userId: string;
  name: string | null;
  email: string;
  isCreator: boolean;
};

// Approved members plus the event's creator (implicitly approved, specs/spec.md §4),
// for the admin participant list (specs/spec.md §5.3).
export async function listParticipants(event: EventRow): Promise<Participant[]> {
  const supabase = createServerSupabaseClient();
  const [{ data: members, error }, { data: creator, error: cError }] =
    await Promise.all([
      supabase
        .from("event_memberships")
        .select("id, user_id, users!user_id ( name, email )")
        .eq("event_id", event.id)
        .eq("status", "approved")
        .order("requested_at"),
      supabase
        .from("users")
        .select("id, name, email")
        .eq("id", event.created_by)
        .single(),
    ]);
  if (error || cError) {
    throw new Error(
      `Failed to list participants: ${(error ?? cError)!.message}`
    );
  }

  const rows: Participant[] = (members ?? [])
    .filter((row) => (row.user_id as string) !== event.created_by)
    .map((row) => {
      const u = row.users as unknown as { name: string | null; email: string };
      return {
        membershipId: row.id as string,
        userId: row.user_id as string,
        name: u?.name ?? null,
        email: u?.email ?? "",
        isCreator: false,
      };
    });

  return [
    {
      membershipId: null,
      userId: creator.id as string,
      name: creator.name as string | null,
      email: creator.email as string,
      isCreator: true,
    },
    ...rows,
  ];
}

export type AvailabilityEntry = {
  day: string;
  user_id: string;
  userName: string;
};

// Every marked day for the event, with who marked it (for the ranking
// panel and for highlighting the viewer's own selections).
export async function listAvailability(
  eventId: string
): Promise<AvailabilityEntry[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("availabilities")
    .select("day, user_id, users ( name, email )")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`Failed to load availability: ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const u = row.users as unknown as { name: string | null; email: string };
    return {
      day: row.day as string,
      user_id: row.user_id as string,
      userName: u?.name ?? u?.email ?? "?",
    };
  });
}
