"use client";

import { useTransition } from "react";
import { deleteEvent } from "@/app/actions";

export function DeleteEventButton({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const ok = window.confirm(
      `Delete "${eventTitle}"? This removes all access requests and votes too. This cannot be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      await deleteEvent(eventId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
    >
      {isPending ? "Deleting…" : "Delete event"}
    </button>
  );
}
