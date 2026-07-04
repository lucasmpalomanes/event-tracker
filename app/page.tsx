import Link from "next/link";
import { getCurrentUser } from "@/lib/dal";
import { listEvents, type EventListItem } from "@/lib/events";
import { requestAccess } from "@/app/actions";

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
        <span className="font-medium text-black dark:text-zinc-50">
          {event.title}
        </span>
        <span className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
          {STATUS_LABEL[event.status]}
        </span>
        {isAdmin && event.pendingCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {event.pendingCount} pending request
            {event.pendingCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {event.status === "finalized" && event.finalized_date
          ? `Happening on ${formatDay(event.finalized_date)}`
          : `${formatDay(event.window_start)} – ${formatDay(event.window_end)}`}
        {event.location ? ` · ${event.location}` : ""}
      </span>
    </div>
  );

  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
      {canEnter ? (
        <Link href={`/events/${event.id}`} className="flex-1 hover:opacity-80">
          {body}
        </Link>
      ) : (
        <div className="flex-1">{body}</div>
      )}

      {!canEnter && event.membership === null && (
        <form action={requestAccess.bind(null, event.id)}>
          <button className="rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]">
            Request to enter
          </button>
        </form>
      )}
      {!canEnter && event.membership === "pending" && (
        <span className="text-sm text-zinc-500">Awaiting approval</span>
      )}
      {!canEnter && event.membership === "rejected" && (
        <form action={requestAccess.bind(null, event.id)}>
          <button className="rounded-full border border-black/[.08] px-4 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]">
            Request again
          </button>
        </form>
      )}
    </li>
  );
}

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-16 py-32 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Gagasco
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Pick the best date for your next get-together. Log in to see the
            events and vote on the days you&apos;re available.
          </p>
          <a
            href="/auth/login"
            className="flex h-12 items-center justify-center rounded-full bg-black px-8 font-medium text-white transition-colors hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]"
          >
            Log in
          </a>
        </main>
      </div>
    );
  }

  const events = await listEvents(user);

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <header className="flex w-full items-center justify-between border-b border-black/[.08] px-8 py-4 dark:border-white/[.145]">
        <span className="font-semibold text-black dark:text-zinc-50">
          Gagasco
        </span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {user.name ?? user.email}
            {user.is_admin && " (admin)"}
          </span>
          <a
            href="/auth/logout"
            className="rounded-full border border-black/[.08] px-4 py-1.5 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            Log out
          </a>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Events
          </h1>
          {user.is_admin && (
            <Link
              href="/events/new"
              className="rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]"
            >
              Create event
            </Link>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
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
