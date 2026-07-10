"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("event");
  const { t: tCommon } = useTranslation("common");
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
          {t("autoApprove.label")}
        </TooltipTrigger>
        <TooltipContent>{t("autoApprove.tooltip")}</TooltipContent>
      </Tooltip>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("autoApprove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("autoApprove.description", { count: pendingCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                apply(true);
              }}
            >
              {t("autoApprove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
