import Link from "next/link";
import { getCurrentUser } from "@/lib/dal";
import { listEvents, type EventListItem } from "@/lib/events";
import { requestAccess } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function formatDay(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABEL: Record<EventListItem["status"], string> = {
  open: "Voting open",
  closed: "Voting closed",
  finalized: "Finalized",
};

function EventRow({
  event,
  isAdmin,
}: {
  event: EventListItem;
  isAdmin: boolean;
}) {
  const canEnter = isAdmin || event.membership === "approved";

  const body = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <span className="font-medium">{event.title}</span>
        <Badge variant="outline">{STATUS_LABEL[event.status]}</Badge>
        {isAdmin && event.pendingCount > 0 && (
          <Badge className="bg-warning text-warning-foreground">
            {event.pendingCount} pending request
            {event.pendingCount > 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      <span className="text-sm text-muted-foreground">
        {event.status === "finalized" && event.finalized_date
          ? `Happening on ${formatDay(event.finalized_date)}`
          : `${formatDay(event.window_start)} – ${formatDay(event.window_end)}`}
        {event.location ? ` · ${event.location}` : ""}
      </span>
    </div>
  );

  return (
    <li>
      <Card className="flex-row items-center justify-between gap-4 p-4">
        {canEnter ? (
          <Link
            href={`/events/${event.id}`}
            className="flex-1 hover:opacity-80"
          >
            {body}
          </Link>
        ) : (
          <div className="flex-1">{body}</div>
        )}

        {!canEnter && event.membership === null && (
          <form action={requestAccess.bind(null, event.id)}>
            {/* Auto-approve events grant access on the spot, so the button
                reads "Join" to set expectations (specs/spec.md §5.1). */}
            <Button type="submit" size="sm">
              {event.auto_approve_members ? "Join" : "Request to enter"}
            </Button>
          </form>
        )}
        {!canEnter && event.membership === "pending" && (
          <span className="text-sm text-muted-foreground">
            Awaiting approval
          </span>
        )}
        {!canEnter && event.membership === "rejected" && (
          <form action={requestAccess.bind(null, event.id)}>
            <Button type="submit" size="sm" variant="outline">
              Request again
            </Button>
          </form>
        )}
      </Card>
    </li>
  );
}

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center">
        <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-16 py-32 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Gagasco</h1>
          <p className="max-w-md text-lg leading-8 text-muted-foreground">
            Pick the best date for your next get-together. Log in to see the
            events and vote on the days you&apos;re available.
          </p>
          <Button size="lg" nativeButton={false} render={<a href="/auth/login" />}>
            Log in
          </Button>
        </main>
      </div>
    );
  }

  const events = await listEvents(user);

  return (
    <div className="flex flex-col flex-1">
      <header className="flex w-full items-center justify-between border-b px-8 py-4">
        <span className="font-semibold">Gagasco</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {user.name ?? user.email}
            {user.is_admin && " (admin)"}
          </span>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href="/auth/logout" />}
          >
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          {user.is_admin && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/events/new" />}
            >
              Create event
            </Button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-muted-foreground">
            No events yet.
            {user.is_admin && " Create the first one!"}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow key={event.id} event={event} isAdmin={user.is_admin} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
