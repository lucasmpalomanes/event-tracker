"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "lucide-react";
import {
  addBudgetItem,
  deleteBudgetItem,
  updateBudgetItem,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EditableBudgetItem = {
  id: string;
  name: string;
  amountReais: string; // "55.00" — formatted server-side for the input
  exemption: string;
};

const EXEMPTIONS = ["none", "alcohol", "meat"] as const;

function ExemptionSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("budget");
  const items = Object.fromEntries(
    EXEMPTIONS.map((v) => [v, t(`exemption.${v}`)])
  );
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => onChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EXEMPTIONS.map((v) => (
          <SelectItem key={v} value={v}>
            {t(`exemption.${v}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function parseCents(amountReais: string): number {
  return Math.round(Number(amountReais.replace(",", ".")) * 100);
}

function ItemRow({
  eventId,
  item,
}: {
  eventId: string;
  item: EditableBudgetItem;
}) {
  const { t } = useTranslation("budget");
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(item.amountReais);
  const [exemption, setExemption] = useState(item.exemption);
  const [isPending, startTransition] = useTransition();

  const dirty =
    name !== item.name ||
    amount !== item.amountReais ||
    exemption !== item.exemption;

  return (
    <li className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={t("editor.itemName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isPending}
        className="h-8 flex-1 basis-40"
      />
      <Input
        aria-label={t("editor.amount")}
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={isPending}
        className="h-8 w-28"
      />
      <ExemptionSelect
        value={exemption}
        onChange={setExemption}
        disabled={isPending}
      />
      <Button
        size="xs"
        variant="outline"
        disabled={!dirty || isPending}
        onClick={() =>
          startTransition(async () => {
            await updateBudgetItem(
              eventId,
              item.id,
              name,
              parseCents(amount),
              exemption,
            );
          })
        }
      >
        {isPending ? t("editor.saving") : t("editor.save")}
      </Button>
      {/* No confirmation — items are cheap to re-add (specs/event-budget.md §6.3). */}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t("editor.remove", { name: item.name })}
        className="text-muted-foreground hover:text-destructive"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await deleteBudgetItem(eventId, item.id);
          })
        }
      >
        <XIcon />
      </Button>
    </li>
  );
}

export function BudgetItemsEditor({
  eventId,
  items,
}: {
  eventId: string;
  items: EditableBudgetItem[];
}) {
  const { t } = useTranslation("budget");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [exemption, setExemption] = useState("none");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ItemRow key={item.id} eventId={eventId} item={item} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            await addBudgetItem(eventId, name, parseCents(amount), exemption);
            setName("");
            setAmount("");
            setExemption("none");
          });
        }}
      >
        <Input
          aria-label={t("editor.newItemName")}
          placeholder={t("editor.itemPlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          className="h-8 flex-1 basis-40"
        />
        <Input
          aria-label={t("editor.newItemAmount")}
          type="number"
          placeholder={t("editor.amountPlaceholder")}
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isPending}
          className="h-8 w-28"
        />
        <ExemptionSelect
          value={exemption}
          onChange={setExemption}
          disabled={isPending}
        />
        <Button
          type="submit"
          size="xs"
          disabled={isPending || !name.trim() || !(parseCents(amount) > 0)}
        >
          {isPending ? t("editor.adding") : t("editor.add")}
        </Button>
      </form>
    </div>
  );
}
