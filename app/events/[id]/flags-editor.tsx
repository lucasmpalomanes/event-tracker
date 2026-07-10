"use client";

import { useTransition } from "react";
import { useTranslation } from "react-i18next";
import { setConsumptionFlags } from "@/app/actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Consumption flags, self-declared, editable at any event status until
// charging is activated (specs/event-budget.md §6.2).
export function FlagsEditor({
  eventId,
  noAlcohol,
  noMeat,
  chargingActive,
}: {
  eventId: string;
  noAlcohol: boolean;
  noMeat: boolean;
  chargingActive: boolean;
}) {
  const { t } = useTranslation("budget");
  const [isPending, startTransition] = useTransition();

  function apply(flags: { noAlcohol: boolean; noMeat: boolean }) {
    startTransition(async () => {
      await setConsumptionFlags(eventId, flags);
    });
  }

  if (chargingActive) {
    return (
      <p className="text-xs text-muted-foreground">{t("flags.locked")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`no-alcohol-${eventId}`}
          size="sm"
          checked={noAlcohol}
          disabled={isPending}
          onCheckedChange={(checked) =>
            apply({ noAlcohol: checked, noMeat })
          }
        />
        <Label
          htmlFor={`no-alcohol-${eventId}`}
          className="text-xs text-muted-foreground"
        >
          {t("flags.noAlcohol")}
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`no-meat-${eventId}`}
          size="sm"
          checked={noMeat}
          disabled={isPending}
          onCheckedChange={(checked) =>
            apply({ noAlcohol, noMeat: checked })
          }
        />
        <Label
          htmlFor={`no-meat-${eventId}`}
          className="text-xs text-muted-foreground"
        >
          {t("flags.noMeat")}
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">{t("flags.hint")}</p>
    </div>
  );
}
