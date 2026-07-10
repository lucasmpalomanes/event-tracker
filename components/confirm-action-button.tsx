"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ButtonProps = React.ComponentProps<typeof Button>;

// Button that asks for confirmation before invoking a server action
// (specs/shadcn-refactor.md §5.6). All destructive actions go through this:
// the deletes are hard and have no undo, and finalize/close-voting end live
// voting (specs/spec.md §5.2–5.3).
export function ConfirmActionButton({
  action,
  title,
  description,
  confirmLabel,
  confirmVariant = "destructive",
  variant = "outline",
  size = "xs",
  className,
  disabled,
  pendingLabel,
  tooltip,
  "aria-label": ariaLabel,
  children,
}: {
  action: () => Promise<unknown>;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonProps["variant"];
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
  pendingLabel?: ReactNode;
  tooltip?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      await action();
    });
  }

  const trigger = (
    <AlertDialogTrigger
      aria-label={ariaLabel}
      // Fallback for when the trigger is disabled and the Tooltip can't open.
      title={tooltip}
      disabled={disabled || isPending}
      render={<Button variant={variant} size={size} className={className} />}
    >
      {isPending ? (pendingLabel ?? children) : children}
    </AlertDialogTrigger>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant={confirmVariant} onClick={handleConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
