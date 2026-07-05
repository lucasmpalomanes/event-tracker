"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAvailability } from "@/app/actions";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// The voting grid stays a custom component (specs/shadcn-refactor.md §5.4):
// shadcn's Calendar is a date picker, not a multi-month toggle board. Cells
// use the shared holiday/weekend/available tokens from globals.css.
export function VotingCalendar({
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
          <h3 className="mb-2 text-sm font-medium">{month.label}</h3>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((wd, i) => (
              <span
                key={i}
                className="pb-1 text-center text-xs text-muted-foreground/70"
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

              const dayButton = (
                <button
                  key={cell.day}
                  type="button"
                  disabled={!interactive}
                  onClick={() => toggle(cell)}
                  // Fallback for cells the Tooltip can't serve (disabled).
                  title={cell.holiday ?? undefined}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                    // Precedence: holiday > weekend > weekday (specs/spec.md §5.2).
                    cell.holiday
                      ? "bg-holiday text-holiday-foreground"
                      : cell.isWeekend
                        ? "bg-weekend text-weekend-foreground"
                        : "bg-card text-card-foreground",
                    cell.inWindow
                      ? "border-border"
                      : "border-transparent opacity-30",
                    mine && "border-2 border-available",
                    interactive && "cursor-pointer hover:opacity-75",
                  )}
                >
                  <span>{cell.dom}</span>
                  {cell.inWindow && count > 0 && (
                    <span className="text-[8px] leading-none text-muted-foreground">
                      {count} {count === 1 ? "vote" : "votes"}
                    </span>
                  )}
                </button>
              );

              return cell.holiday ? (
                <Tooltip key={cell.day}>
                  <TooltipTrigger render={dayButton} />
                  <TooltipContent>{cell.holiday}</TooltipContent>
                </Tooltip>
              ) : (
                dayButton
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
