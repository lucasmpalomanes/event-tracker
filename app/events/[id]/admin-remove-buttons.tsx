"use client";

import { useTransition } from "react";
import {
  clearUserVotes,
  removeParticipant,
  removeSingleVote,
} from "@/app/actions";

// Admin-only removal actions (spec.md §5.3). Each asks for confirmation:
// the deletes are hard and have no undo.

export function RemoveParticipantButton({
  eventId,
  membershipId,
  userName,
}: {
  eventId: string;
  membershipId: string;
  userName: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const ok = window.confirm(
      `Remove ${userName} from this event? All of their votes are deleted too. They can request to enter again later. This cannot be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      await removeParticipant(eventId, membershipId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
    >
      {isPending ? "Removing…" : "Remove"}
    </button>
  );
}

export function ClearVotesButton({
  eventId,
  userId,
  userName,
  voteCount,
}: {
  eventId: string;
  userId: string;
  userName: string;
  voteCount: number;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const ok = window.confirm(
      `Clear all ${voteCount} of ${userName}'s votes for this event? They stay in the event and can vote again. This cannot be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      await clearUserVotes(eventId, userId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || voteCount === 0}
      className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
    >
      {isPending ? "Clearing…" : "Clear votes"}
    </button>
  );
}

export function RemoveVoteButton({
  eventId,
  userId,
  userName,
  day,
  dayLabel,
}: {
  eventId: string;
  userId: string;
  userName: string;
  day: string;
  dayLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const ok = window.confirm(
      `Remove ${userName}'s vote on ${dayLabel}? This cannot be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      await removeSingleVote(eventId, userId, day);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title={`Remove ${userName}'s vote on ${dayLabel}`}
      aria-label={`Remove ${userName}'s vote on ${dayLabel}`}
      className="rounded-full px-1 leading-none text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
    >
      ×
    </button>
  );
}
