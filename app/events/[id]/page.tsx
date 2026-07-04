import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import {
  canEnterEvent,
  getEvent,
  getMembership,
  listAvailability,
  listPendingRequests,
} from "@/lib/events";
import { holidaysInRange } from "@/lib/holidays";
import {
  closeVoting,
  decideMembership,
  finalizeEvent,
  reopenVoting,
  updateEventDetails,
} from "@/app/actions";
import { Calendar, type CalendarMonth } from "./calendar";
import { DeleteEventButton } from "./delete-event-button";

function formatDay(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

// Build one grid per calendar month covered by the window. Days outside
// the window are rendered but non-interactive (spec.md §5.2).
function buildMonths(
  windowStart: string,
  windowEnd: string,
  holidays: Map<string, string>,
  counts: Map<string, number>,
  mine: Set<string>
): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  let year = Number(windowStart.slice(0, 4));
  let month = Number(windowStart.slice(5, 7)); // 1-based

  const lastYear = Number(windowEnd.slice(0, 4));
  const lastMonth = Number(windowEnd.slice(5, 7));

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const cells = [];
    for (let dom = 1; dom <= daysInMonth; dom++) {
      const day = `${year}-${String(month).padStart(2, "0")}-${String(
        dom
      ).padStart(2, "0")}`;
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      cells.push({
        day,
        dom,
        inWindow: day >= windowStart && day <= windowEnd,
        isWeekend: weekday === 0 || weekday === 6,
        holiday: holidays.get(day) ?? null,
        count: counts.get(day) ?? 0,
        mine: mine.has(day),
      });
    }
    months.push({
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      leadingBlanks: firstWeekday,
      cells,
    });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const event = await getEvent(id);
  if (!event) notFound();

  const membership = await getMembership(id, user.id);
  if (!canEnterEvent(user, event, membership)) redirect("/");

  const availability = await listAvailability(id);
  const pendingRequests = user.is_admin ? await listPendingRequests(id) : [];
  const holidays = holidaysInRange(event.window_start, event.window_end);

  const counts = new Map<string, number>();
  const names = new Map<string, string[]>();
  const mine = new Set<string>();
  for (const entry of availability) {
    counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1);
    names.set(entry.day, [...(names.get(entry.day) ?? []), entry.userName]);
    if (entry.user_id === user.id) mine.add(entry.day);
  }

  const months = buildMonths(
    event.window_start,
    event.window_end,
    holidays,
    counts,
    mine
  );

  const ranking = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10);

  const votingOpen = event.status === "open";

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-12">
        <div className="flex flex-col gap-2">
          <Link
            href="/"
            className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
          >
            ← Back to events
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
              {event.title}
            </h1>
            <span className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
              {event.status === "open"
                ? "Voting open"
                : event.status === "closed"
                  ? "Voting closed"
                  : `Finalized: ${formatDay(event.finalized_date!)}`}
            </span>
          </div>
          {event.description && (
            <p className="text-zinc-600 dark:text-zinc-400">
              {event.description}
            </p>
          )}
          {event.location && (
            <p className="text-sm text-zinc-500">📍 {event.location}</p>
          )}
          {user.is_admin && (
            <details className="group mt-1">
              <summary className="cursor-pointer text-sm text-zinc-500 hover:underline">
                Edit details
              </summary>
              <form
                action={updateEventDetails.bind(null, event.id)}
                className="mt-3 flex max-w-md flex-col gap-3"
              >
                <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Description
                  <textarea
                    name="description"
                    rows={3}
                    defaultValue={event.description ?? ""}
                    className="rounded-lg border border-black/[.08] bg-white px-3 py-2 text-black dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Location
                  <input
                    name="location"
                    defaultValue={event.location ?? ""}
                    className="rounded-lg border border-black/[.08] bg-white px-3 py-2 text-black dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </label>
                <button className="self-start rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]">
                  Save
                </button>
              </form>
            </details>
          )}
        </div>

        {user.is_admin && pendingRequests.length > 0 && (
          <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
            <h2 className="font-medium text-amber-900 dark:text-amber-200">
              Pending access requests
            </h2>
            <ul className="flex flex-col gap-2">
              {pendingRequests.map((req) => (
                <li key={req.id} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 text-zinc-800 dark:text-zinc-200">
                    {req.user.name ?? req.user.email}
                  </span>
                  <form action={decideMembership.bind(null, req.id, "approved")}>
                    <button className="rounded-full bg-black px-3 py-1 text-xs text-white hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]">
                      Approve
                    </button>
                  </form>
                  <form action={decideMembership.bind(null, req.id, "rejected")}>
                    <button className="rounded-full border border-black/[.08] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]">
                      Reject
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-8 lg:flex-row">
          <section className="flex-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium text-black dark:text-zinc-50">
                {votingOpen
                  ? "Click the days you're available"
                  : "Availability (voting closed)"}
              </h2>
              {user.is_admin && (
                <div className="flex items-center gap-2">
                  {votingOpen && (
                    <form action={closeVoting.bind(null, event.id)}>
                      <button className="rounded-full border border-black/[.08] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]">
                        Close voting
                      </button>
                    </form>
                  )}
                  {event.status === "closed" && (
                    <form action={reopenVoting.bind(null, event.id)}>
                      <button className="rounded-full border border-black/[.08] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]">
                        Reopen voting
                      </button>
                    </form>
                  )}
                  <DeleteEventButton
                    eventId={event.id}
                    eventTitle={event.title}
                  />
                </div>
              )}
            </div>
            <Calendar eventId={event.id} months={months} canVote={votingOpen} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-rose-100 dark:bg-rose-950" />
                Holiday
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-sky-100 dark:bg-sky-950" />
                Weekend
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border-2 border-green-500" />
                You&apos;re available
              </span>
            </div>
          </section>

          <aside className="flex w-full flex-col gap-3 lg:w-72">
            <h2 className="font-medium text-black dark:text-zinc-50">
              Most voted days
            </h2>
            {ranking.length === 0 ? (
              <p className="text-sm text-zinc-500">No votes yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {ranking.map(([day, count]) => (
                  <li
                    key={day}
                    className="flex items-center gap-2 rounded-lg border border-black/[.08] bg-white px-3 py-2 text-sm dark:border-white/[.145] dark:bg-zinc-950"
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="text-black dark:text-zinc-50">
                        {formatDay(day)}
                        {holidays.has(day) && (
                          <span className="ml-1 text-xs text-rose-600 dark:text-rose-400">
                            ({holidays.get(day)})
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {names.get(day)?.join(", ")}
                      </span>
                    </div>
                    <span className="font-semibold text-black dark:text-zinc-50">
                      {count}
                    </span>
                    {user.is_admin && event.status !== "finalized" && (
                      <form action={finalizeEvent.bind(null, event.id, day)}>
                        <button
                          className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                          title="Finalize this date"
                        >
                          Pick
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
