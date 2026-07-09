import type { EventRow, Participant } from "@/lib/events";
import {
  amountFor,
  computeShares,
  formatBRL,
  type BudgetItem,
  type ChargeSettings,
} from "@/lib/budget";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  BudgetItemsEditor,
  type EditableBudgetItem,
} from "./budget-items-editor";
import { FlagsEditor } from "./flags-editor";

const EXEMPTION_LABELS: Record<BudgetItem["exemption"], string> = {
  none: "Everyone",
  alcohol: "Drinkers",
  meat: "Meat-eaters",
};

// The Budget tab (specs/event-budget.md §6): itemized costs, live per-person
// shares, and the viewer's own flags + share. Charge activation and payment
// UI land here with the Pix integration (specs/pix-payments.md).
export function BudgetTab({
  event,
  viewerId,
  isAdmin,
  participants,
  items,
  chargeSettings,
}: {
  event: EventRow;
  viewerId: string;
  isAdmin: boolean;
  participants: Participant[];
  items: BudgetItem[];
  chargeSettings: ChargeSettings | null;
}) {
  const shares = computeShares(
    items,
    participants.map((p) => ({ no_alcohol: p.noAlcohol, no_meat: p.noMeat })),
  );

  const viewer = participants.find((p) => p.userId === viewerId);
  const viewerFlags = {
    no_alcohol: viewer?.noAlcohol ?? false,
    no_meat: viewer?.noMeat ?? false,
  };
  const yourShare = amountFor(shares, viewerFlags);
  const fullPrice = shares.generalShare + shares.alcoholShare + shares.meatShare;

  const groupSize: Record<BudgetItem["exemption"], number> = {
    none: shares.headcount,
    alcohol: shares.drinkers,
    meat: shares.meatEaters,
  };

  const editableItems: EditableBudgetItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    amountReais: (item.amount_cents / 100).toFixed(2),
    exemption: item.exemption,
  }));

  // "R$ 60 − R$ 15 (não bebe) = R$ 45" (specs/event-budget.md §6.2).
  const deductions = [
    viewerFlags.no_alcohol && shares.alcoholShare > 0
      ? `− ${formatBRL(shares.alcoholShare)} (não bebe)`
      : null,
    viewerFlags.no_meat && shares.meatShare > 0
      ? `− ${formatBRL(shares.meatShare)} (não come carne)`
      : null,
  ].filter(Boolean);

  return (
    <>
      <Card className="gap-3 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Budget items</h2>
          {items.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Total: {formatBRL(shares.totalCents)}
            </span>
          )}
        </div>
        {isAdmin ? (
          <BudgetItemsEditor eventId={event.id} items={editableItems} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            O organizador ainda não montou o orçamento.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="flex-1">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {EXEMPTION_LABELS[item.exemption]} ·{" "}
                  {groupSize[item.exemption]}{" "}
                  {groupSize[item.exemption] === 1 ? "person" : "people"}
                </span>
                <span className="w-20 text-right font-medium">
                  {formatBRL(item.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {items.length > 0 && (
        <Card className="gap-3 p-4">
          <h2 className="font-medium">Cost split</h2>
          <p className="text-sm text-muted-foreground">
            {shares.headcount}{" "}
            {shares.headcount === 1 ? "participant" : "participants"} ·{" "}
            {shares.drinkers} {shares.drinkers === 1 ? "drinker" : "drinkers"} ·{" "}
            {shares.meatEaters}{" "}
            {shares.meatEaters === 1 ? "meat-eater" : "meat-eaters"}
          </p>
          {shares.unsplitAlcohol && (
            <p className="text-sm text-warning-foreground">
              There are drink costs but no drinkers to split them — retag or
              remove those items.
            </p>
          )}
          {shares.unsplitMeat && (
            <p className="text-sm text-warning-foreground">
              There are meat costs but no meat-eaters to split them — retag or
              remove those items.
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            <li className="flex justify-between">
              <span>Full price</span>
              <span className="font-medium">{formatBRL(fullPrice)}</span>
            </li>
            <li className="flex justify-between">
              <span>No alcohol</span>
              <span className="font-medium">
                {formatBRL(fullPrice - shares.alcoholShare)}
              </span>
            </li>
            <li className="flex justify-between">
              <span>No meat</span>
              <span className="font-medium">
                {formatBRL(fullPrice - shares.meatShare)}
              </span>
            </li>
            <li className="flex justify-between">
              <span>No alcohol + no meat</span>
              <span className="font-medium">{formatBRL(shares.generalShare)}</span>
            </li>
          </ul>
        </Card>
      )}

      <Card className="gap-3 p-4">
        <h2 className="font-medium">Your share</h2>
        {items.length > 0 ? (
          <p className="text-lg font-semibold">
            {deductions.length > 0 ? (
              <>
                <span className="font-normal text-muted-foreground">
                  {formatBRL(fullPrice)} {deductions.join(" ")} ={" "}
                </span>
                {formatBRL(yourShare)}
              </>
            ) : (
              formatBRL(yourShare)
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No items yet — your share shows up once the budget has costs.
          </p>
        )}
        <Separator />
        <FlagsEditor
          eventId={event.id}
          noAlcohol={viewerFlags.no_alcohol}
          noMeat={viewerFlags.no_meat}
          chargingActive={chargeSettings !== null}
        />
      </Card>
    </>
  );
}
