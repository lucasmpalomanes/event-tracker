"use client";

import { useState, useTransition } from "react";
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

const EXEMPTION_LABELS: Record<string, string> = {
  none: "Everyone",
  alcohol: "Drinkers",
  meat: "Meat-eaters",
};

function parseCents(amountReais: string): number {
  return Math.round(Number(amountReais.replace(",", ".")) * 100);
}

function ExemptionSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <Select
      items={EXEMPTION_LABELS}
      value={value}
      onValueChange={(v) => onChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(EXEMPTION_LABELS).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ItemRow({
  eventId,
  item,
}: {
  eventId: string;
  item: EditableBudgetItem;
}) {
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
        aria-label="Item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isPending}
        className="h-8 flex-1 basis-40"
      />
      <Input
        aria-label="Amount (R$)"
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
        {isPending ? "Saving…" : "Save"}
      </Button>
      {/* No confirmation — items are cheap to re-add (specs/event-budget.md §6.3). */}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Remove ${item.name}`}
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
          aria-label="New item name"
          placeholder="Item (picanha, carvão…)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          className="h-8 flex-1 basis-40"
        />
        <Input
          aria-label="New item amount (R$)"
          type="number"
          placeholder="R$"
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
          {isPending ? "Adding…" : "Add item"}
        </Button>
      </form>
    </div>
  );
}
