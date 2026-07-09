"use client";

import { useState, useTransition } from "react";
import { activateCharging } from "@/app/actions";
import { formatBRL } from "@/lib/format";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ActivationParticipant = {
  userId: string;
  name: string | null;
  email: string;
  noAlcohol: boolean;
  noMeat: boolean;
};

function parseCents(value: string): number {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

// Activation form (specs/pix-payments.md §7.2): base price + two deductions,
// prefilled from the budget when it has items (specs/event-budget.md §6.3),
// with a live per-participant amount preview and a confirmation step.
export function ActivateChargingForm({
  eventId,
  participants,
  prefill,
}: {
  eventId: string;
  participants: ActivationParticipant[];
  prefill: { baseCents: number; alcoholCents: number; meatCents: number } | null;
}) {
  const toReais = (cents: number) => (cents / 100).toFixed(2);
  const [base, setBase] = useState(prefill ? toReais(prefill.baseCents) : "");
  const [alcohol, setAlcohol] = useState(
    prefill ? toReais(prefill.alcoholCents) : "0"
  );
  const [meat, setMeat] = useState(prefill ? toReais(prefill.meatCents) : "0");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const baseCents = parseCents(base);
  const alcoholCents = parseCents(alcohol);
  const meatCents = parseCents(meat);
  const valid =
    Number.isInteger(baseCents) &&
    Number.isInteger(alcoholCents) &&
    Number.isInteger(meatCents) &&
    baseCents > 0 &&
    alcoholCents >= 0 &&
    meatCents >= 0;
  // A fully-deducted participant must still owe > 0 (specs/pix-payments.md §4).
  const minimumOk = valid && baseCents - alcoholCents - meatCents > 0;

  const amountFor = (p: ActivationParticipant) =>
    baseCents -
    (p.noAlcohol ? alcoholCents : 0) -
    (p.noMeat ? meatCents : 0);

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await activateCharging(eventId, {
          basePriceCents: baseCents,
          noAlcoholDeductionCents: alcoholCents,
          noMeatDeductionCents: meatCents,
        });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Activation failed"
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="base-price">Base price (R$)</Label>
          <Input
            id="base-price"
            inputMode="decimal"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ded-alcohol">− no alcohol</Label>
          <Input
            id="ded-alcohol"
            inputMode="decimal"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ded-meat">− no meat</Label>
          <Input
            id="ded-meat"
            inputMode="decimal"
            value={meat}
            onChange={(e) => setMeat(e.target.value)}
          />
        </div>
      </div>

      {valid && !minimumOk && (
        <p className="text-sm text-warning-foreground">
          Base price minus both deductions must stay above zero — adicione um
          item que todos dividem, ou trate os isentos manualmente.
        </p>
      )}

      {minimumOk && (
        <ul className="flex flex-col gap-1 text-sm">
          {participants.map((p) => (
            <li key={p.userId} className="flex justify-between">
              <span>{p.name ?? p.email}</span>
              <span className="font-medium">{formatBRL(amountFor(p))}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog>
        <AlertDialogTrigger
          disabled={!minimumOk || isPending}
          render={<Button size="sm" className="self-start" />}
        >
          {isPending ? "Activating…" : "Ativar cobrança"}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate charging?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a Pix charge for each of the{" "}
              {participants.length} approved participants. Prices are frozen —
              changing them later means deactivating and reactivating.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Activate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
