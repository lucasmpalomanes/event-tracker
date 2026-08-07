"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import {
  addCompanion,
  adminAddCompanion,
  adminRemoveCompanion,
  adminUpdateCompanion,
  removeCompanion,
  updateCompanion,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type EditableCompanion = {
  id: string;
  name: string;
  noAlcohol: boolean;
  noMeat: boolean;
};

type CompanionInput = { name: string; noAlcohol: boolean; noMeat: boolean };

// Companion CRUD (specs/companions.md §7.1): name + the two flags, nothing
// else. Self mode edits the viewer's own companions while charging is
// inactive; admin mode (payment board, §7.4) edits any host's at any time —
// the server regenerates the host's unpaid charge on every change (§6).
export function CompanionsEditor({
  eventId,
  companions,
  admin,
}: {
  eventId: string;
  companions: EditableCompanion[];
  // Present = admin mode, acting on this host's companions.
  admin?: { hostUserId: string; chargingActive: boolean };
}) {
  const { t } = useTranslation("budget");
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
    });

  const add = (input: CompanionInput) =>
    admin
      ? adminAddCompanion(eventId, admin.hostUserId, input)
      : addCompanion(eventId, input);
  const update = (id: string, input: CompanionInput) =>
    admin
      ? adminUpdateCompanion(eventId, id, input)
      : updateCompanion(eventId, id, input);
  const remove = (id: string) =>
    admin
      ? adminRemoveCompanion(eventId, id)
      : removeCompanion(eventId, id);

  return (
    <div className="flex flex-col gap-2">
      {companions.map((c) => (
        <CompanionRow
          key={c.id}
          companion={c}
          disabled={isPending}
          onSave={(input) => run(() => update(c.id, input))}
          onRemove={() => run(() => remove(c.id))}
        />
      ))}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          // New companions drink and eat meat — the default that never
          // under-collects (specs/companions.md §9).
          run(async () => {
            await add({ name, noAlcohol: false, noMeat: false });
            setNewName("");
          });
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("companions.namePlaceholder")}
          aria-label={t("companions.namePlaceholder")}
          maxLength={60}
          className="h-8 max-w-52 text-sm"
          disabled={isPending}
        />
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={isPending || newName.trim() === ""}
        >
          {isPending ? t("companions.adding") : t("companions.add")}
        </Button>
      </form>

      {admin?.chargingActive && (
        <p className="text-xs text-muted-foreground">
          {t("companions.regenNote")}
        </p>
      )}
    </div>
  );
}

function CompanionRow({
  companion,
  disabled,
  onSave,
  onRemove,
}: {
  companion: EditableCompanion;
  disabled: boolean;
  onSave: (input: CompanionInput) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("budget");
  const [name, setName] = useState(companion.name);

  const flags = { noAlcohol: companion.noAlcohol, noMeat: companion.noMeat };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== companion.name) {
            onSave({ ...flags, name: trimmed });
          } else {
            setName(companion.name);
          }
        }}
        aria-label={t("companions.namePlaceholder")}
        maxLength={60}
        className="h-8 max-w-52 text-sm"
        disabled={disabled}
      />
      <span className="flex items-center gap-2">
        <Switch
          id={`companion-alcohol-${companion.id}`}
          size="sm"
          checked={companion.noAlcohol}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onSave({ ...flags, name: companion.name, noAlcohol: checked })
          }
        />
        <Label
          htmlFor={`companion-alcohol-${companion.id}`}
          className="text-xs text-muted-foreground"
        >
          {t("companions.noAlcohol")}
        </Label>
      </span>
      <span className="flex items-center gap-2">
        <Switch
          id={`companion-meat-${companion.id}`}
          size="sm"
          checked={companion.noMeat}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onSave({ ...flags, name: companion.name, noMeat: checked })
          }
        />
        <Label
          htmlFor={`companion-meat-${companion.id}`}
          className="text-xs text-muted-foreground"
        >
          {t("companions.noMeat")}
        </Label>
      </span>
      {/* Inline, no confirmation while charging is inactive — a mis-click is
          one re-add away (specs/companions.md §7.1). Admin mode gets the
          static regeneration note instead. */}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        disabled={disabled}
        onClick={onRemove}
        aria-label={t("companions.remove", { name: companion.name })}
      >
        {t("companions.removeLabel")}
      </Button>
    </div>
  );
}
