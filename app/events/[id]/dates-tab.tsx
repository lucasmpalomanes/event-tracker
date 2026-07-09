import type { AvailabilityEntry, EventRow, Participant, PendingRequest } from "@/lib/events";
import { holidaysInRange } from "@/lib/holidays";
import { formatDay } from "@/lib/utils";
import {
  clearUserVotes,
  closeVoting,
  decideMembership,
  deleteEvent,
  finalizeEvent,
  removeParticipant,
  removeSingleVote,
  reopenVoting,
} from "@/app/actions";
import { AutoApproveToggle } from "./auto-approve-toggle";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import {
  VotingCalendar,
  type CalendarMonth,
} from "@/components/voting-calendar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Build one grid per calendar month covered by the window. Days outside
// the window are rendered but non-interactive (specs/spec.md §5.2).
function buildMonths(
  windowStart: string,
  windowEnd: string,
  holidays: Map<string, string>,
  counts: Map<string, number>,
  mine: Set<string>,
): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
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
        dom,
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

// The Dates tab: availability calendar, admin voting controls, ranking
// panel, and participant management (specs/spec.md §5.2, tab structure per
// specs/event-budget.md §6.1).
export function DatesTab({
  event,
  viewerId,
  isAdmin,
  pendingRequests,
  participants,
  availability,
}: {
  event: EventRow;
  viewerId: string;
  isAdmin: boolean;
  pendingRequests: PendingRequest[];
  participants: Participant[];
  availability: AvailabilityEntry[];
}) {
  const holidays = holidaysInRange(event.window_start, event.window_end);

  const counts = new Map<string, number>();
  const voters = new Map<string, { userId: string; name: string }[]>();
  const votesByUser = new Map<string, number>();
  const mine = new Set<string>();
  for (const entry of availability) {
    counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1);
    voters.set(entry.day, [
      ...(voters.get(entry.day) ?? []),
      { userId: entry.user_id, name: entry.userName },
    ]);
    votesByUser.set(entry.user_id, (votesByUser.get(entry.user_id) ?? 0) + 1);
    if (entry.user_id === viewerId) mine.add(entry.day);
  }

  const months = buildMonths(
    event.window_start,
    event.window_end,
    holidays,
    counts,
    mine,
  );

  const ranking = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10);

  const votingOpen = event.status === "open";
  // Removal is allowed on any status, including finalized (specs/spec.md §5.3,
  // revised 2026-07-08) — people can change their mind about attending.
  const canRemove = isAdmin;

  return (
    <>
      {isAdmin && pendingRequests.length > 0 && (
        <Card className="gap-3 bg-warning/40 p-4 ring-warning-foreground/20">
          <h2 className="font-medium text-warning-foreground">
            Pending access requests
          </h2>
          <ul className="flex flex-col gap-2">
            {pendingRequests.map((req) => (
              <li key={req.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{req.user.name ?? req.user.email}</span>
                <form action={decideMembership.bind(null, req.id, "approved")}>
                  <Button type="submit" size="xs">
                    Approve
                  </Button>
                </form>
                <form action={decideMembership.bind(null, req.id, "rejected")}>
                  <Button type="submit" size="xs" variant="outline">
                    Reject
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-col gap-8 lg:flex-row">
        <section className="flex-1">
          <div className="mb-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-medium min-w-40">
              {votingOpen
                ? "Click the days you're available"
                : "Availability (voting closed)"}
            </h2>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <AutoApproveToggle
                  eventId={event.id}
                  enabled={event.auto_approve_members}
                  pendingCount={pendingRequests.length}
                />
                {votingOpen && (
                  // Closing interrupts live voting, so it confirms first
                  // (specs/spec.md §5.2, specs/shadcn-refactor.md §5.3).
                  <ConfirmActionButton
                    action={closeVoting.bind(null, event.id)}
                    title="Close voting?"
                    description={`Close voting for "${event.title}"? Participants can no longer change their availability. You can reopen voting later.`}
                    confirmLabel="Close voting"
                    confirmVariant="default"
                    pendingLabel="Closing…"
                  >
                    Close voting
                  </ConfirmActionButton>
                )}
                {event.status === "closed" && (
                  <form action={reopenVoting.bind(null, event.id)}>
                    <Button type="submit" size="xs" variant="outline">
                      Reopen voting
                    </Button>
                  </form>
                )}
                <ConfirmActionButton
                  action={deleteEvent.bind(null, event.id)}
                  title="Delete event?"
                  description={`Delete "${event.title}"? This removes all access requests and votes too. This cannot be undone.`}
                  confirmLabel="Delete event"
                  variant="destructive"
                  pendingLabel="Deleting…"
                >
                  Delete event
                </ConfirmActionButton>
              </div>
            )}
          </div>
          <VotingCalendar
            eventId={event.id}
            months={months}
            canVote={votingOpen}
          />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-holiday" />
              Holiday
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-weekend" />
              Weekend
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border-2 border-available" />
              You&apos;re available
            </span>
          </div>
        </section>

        <aside className="flex w-full flex-col gap-3 lg:w-72">
          <h2 className="font-medium">Most voted days</h2>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">No votes yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {ranking.map(([day, count]) => (
                <li key={day}>
                  <Card className="flex-row items-center gap-2 p-3 text-sm">
                    <div className="flex flex-1 flex-col">
                      <span>
                        {formatDay(day)}
                        {holidays.has(day) && (
                          <span className="ml-1 text-xs text-holiday-foreground">
                            ({holidays.get(day)})
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {canRemove
                          ? // One voter per line so the remove buttons
                            // stay aligned and scannable.
                            voters.get(day)?.map((voter) => (
                              <span
                                key={voter.userId}
                                className="flex items-center"
                              >
                                {voter.name}
                                <ConfirmActionButton
                                  action={removeSingleVote.bind(
                                    null,
                                    event.id,
                                    voter.userId,
                                    day,
                                  )}
                                  title="Remove vote?"
                                  description={`Remove ${voter.name}'s vote on ${formatDay(day)}? This cannot be undone.`}
                                  confirmLabel="Remove vote"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground hover:text-destructive"
                                  tooltip={`Remove ${voter.name}'s vote on ${formatDay(day)}`}
                                  aria-label={`Remove ${voter.name}'s vote on ${formatDay(day)}`}
                                >
                                  ×
                                </ConfirmActionButton>
                              </span>
                            ))
                          : voters
                              .get(day)
                              ?.map((voter) => voter.name)
                              .join(", ")}
                      </span>
                    </div>
                    <span className="font-semibold">{count}</span>
                    {isAdmin && event.status !== "finalized" && (
                      // Finalizing is one-way (specs/spec.md §5.2), so it
                      // confirms first (specs/shadcn-refactor.md §5.3).
                      <ConfirmActionButton
                        action={finalizeEvent.bind(null, event.id, day)}
                        title="Finalize this date?"
                        description={`Finalize ${formatDay(day)} for "${event.title}"? Voting ends and the event cannot be reopened. This cannot be undone.`}
                        confirmLabel="Finalize"
                        confirmVariant="default"
                        tooltip="Finalize this date"
                      >
                        Pick
                      </ConfirmActionButton>
                    )}
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      {isAdmin && (
        <Card className="gap-3 p-4">
          <h2 className="font-medium">Participants</h2>
          <ul className="flex flex-col gap-2">
            {participants.map((p) => {
              const displayName = p.name ?? p.email;
              const voteCount = votesByUser.get(p.userId) ?? 0;
              return (
                <li
                  key={p.userId}
                  className="flex items-center gap-3 text-sm"
                >
                  <span>
                    {displayName}
                    {p.isCreator && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (creator)
                      </span>
                    )}
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {voteCount} {voteCount === 1 ? "vote" : "votes"}
                  </span>
                  {canRemove && (
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <ConfirmActionButton
                        action={clearUserVotes.bind(null, event.id, p.userId)}
                        title="Clear votes?"
                        description={`Clear all ${voteCount} of ${displayName}'s votes for this event? They stay in the event and can vote again. This cannot be undone.`}
                        confirmLabel="Clear votes"
                        disabled={voteCount === 0}
                        pendingLabel="Clearing…"
                      >
                        Clear votes
                      </ConfirmActionButton>
                      {!p.isCreator && p.membershipId && (
                        <ConfirmActionButton
                          action={removeParticipant.bind(
                            null,
                            event.id,
                            p.membershipId,
                          )}
                          title="Remove participant?"
                          description={`Remove ${displayName} from this event? All of their votes are deleted too. They can request to enter again later. This cannot be undone.`}
                          confirmLabel="Remove"
                          variant="destructive"
                          pendingLabel="Removing…"
                        >
                          Remove
                        </ConfirmActionButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
