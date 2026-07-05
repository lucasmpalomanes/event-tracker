"use client";

import { useTransition } from "react";
import { setAutoApprove } from "@/app/actions";

export function AutoApproveToggle({
  eventId,
  enabled,
  pendingCount,
}: {
  eventId: string;
  enabled: boolean;
  pendingCount: number;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!enabled && pendingCount > 0) {
      const ok = window.confirm(
        `Turning on auto-approve will also approve the ${pendingCount} pending request${
          pendingCount > 1 ? "s" : ""
        } right now. Continue?`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await setAutoApprove(eventId, !enabled);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title="When on, anyone who asks to enter gets access immediately"
      className="rounded-full border border-black/[.08] px-3 py-1 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
    >
      {isPending ? "Saving…" : `Auto-approve: ${enabled ? "on" : "off"}`}
    </button>
  );
}
