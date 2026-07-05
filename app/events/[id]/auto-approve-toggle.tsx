"use client";

import { useState, useTransition } from "react";
import { setAutoApprove } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AutoApproveToggle({
  eventId,
  enabled,
  pendingCount,
}: {
  eventId: string;
  enabled: boolean;
  pendingCount: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function apply(next: boolean) {
    startTransition(async () => {
      await setAutoApprove(eventId, next);
    });
  }

  function handleCheckedChange(checked: boolean) {
    // Turning it on also approves everything pending — confirm first
    // (specs/spec.md §4, auto-approval).
    if (checked && pendingCount > 0) {
      setConfirmOpen(true);
      return;
    }
    apply(checked);
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`auto-approve-${eventId}`}
        size="sm"
        checked={enabled}
        disabled={isPending}
        onCheckedChange={handleCheckedChange}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Label
              htmlFor={`auto-approve-${eventId}`}
              className="text-xs text-muted-foreground"
            />
          }
        >
          Auto-approve
        </TooltipTrigger>
        <TooltipContent>
          When on, anyone who asks to enter gets access immediately
        </TooltipContent>
      </Tooltip>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on auto-approve?</AlertDialogTitle>
            <AlertDialogDescription>
              Turning on auto-approve will also approve the {pendingCount}{" "}
              pending request{pendingCount > 1 ? "s" : ""} right now. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                apply(true);
              }}
            >
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
