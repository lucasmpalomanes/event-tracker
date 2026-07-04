"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAvailability } from "@/app/actions";

export type CalendarDay = {
  day: string; // "YYYY-MM-DD"
  dom: number;
  inWindow: boolean;
  isWeekend: boolean;
  holiday: string | null;
  count: number;
  mine: boolean;
};

export type CalendarMonth = {
  label: string;
  leadingBlanks: number;
  cells: CalendarDay[];
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function Calendar({
  eventId,
  months,
  canVote,
}: {
  eventId: string;
  months: CalendarMonth[];
  canVote: boolean;
}) {
  const [, startTransition] = useTransition();
  // day -> optimistic "mine" value, overriding the server-rendered state
  // until revalidatePath delivers fresh props.
  const [overrides, setOverride] = useOptimistic<
    Record<string, boolean>,
    { day: string; next: boolean }
  >({}, (state, { day, next }) => ({ ...state, [day]: next }));

  function toggle(cell: CalendarDay) {
    const next = !(overrides[cell.day] ?? cell.mine);
    startTransition(async () => {
      setOverride({ day: cell.day, next });
      await toggleAvailability(eventId, cell.day);
    });
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {months.map((month) => (
        <div key={month.label}>
          <h3 className="mb-2 text-sm font-medium text-black dark:text-zinc-50">
            {month.label}
          </h3>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((wd, i) => (
              <span
                key={i}
                className="pb-1 text-center text-xs text-zinc-400 dark:text-zinc-600"
              >
                {wd}
              </span>
            ))}
            {Array.from({ length: month.leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {month.cells.map((cell) => {
              const mine = overrides[cell.day] ?? cell.mine;
              const count = cell.count - (cell.mine ? 1 : 0) + (mine ? 1 : 0);
              const interactive = canVote && cell.inWindow;

              // Precedence: holiday > weekend > weekday (spec.md §5.2).
              const tone = cell.holiday
                ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
                : cell.isWeekend
                  ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                  : "bg-white text-black dark:bg-zinc-950 dark:text-zinc-50";

              return (
                <button
                  key={cell.day}
                  type="button"
                  disabled={!interactive}
                  onClick={() => toggle(cell)}
                  title={cell.holiday ?? undefined}
                  className={[
                    "relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                    tone,
                    cell.inWindow
                      ? "border-black/[.08] dark:border-white/[.145]"
                      : "border-transparent opacity-30",
                    mine ? "border-2 border-green-500 dark:border-green-500" : "",
                    interactive ? "cursor-pointer hover:opacity-75" : "",
                  ].join(" ")}
                >
                  <span>{cell.dom}</span>
                  {cell.inWindow && count > 0 && (
                    <span className="text-[10px] leading-none text-zinc-500 dark:text-zinc-400">
                      {count} {count === 1 ? "vote" : "votes"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
