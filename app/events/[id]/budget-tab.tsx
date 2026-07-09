import type { EventRow, Participant } from "@/lib/events";
import {
  amountFor,
  computeShares,
  formatBRL,
  type BudgetItem,
  type ChargeSettings,
} from "@/lib/budget";
import {
  reconcileChargeWithPsp,
  type PixChargeWithUser,
} from "@/lib/charges";
import { deactivateCharging, syncChargeStatuses } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { ActivateChargingForm } from "./activate-charging-form";
import {
  BudgetItemsEditor,
  type EditableBudgetItem,
} from "./budget-items-editor";
import { FlagsEditor } from "./flags-editor";
import { PaymentBoard } from "./payment-board";
import { PaymentCard } from "./payment-card";

const EXEMPTION_LABELS: Record<BudgetItem["exemption"], string> = {
  none: "Everyone",
  alcohol: "Drinkers",
  meat: "Meat-eaters",
};

// The Budget tab (specs/event-budget.md §6): itemized costs, live per-person
// shares, the viewer's own flags + share, and — the money story — the Pix
// payment card, activation form and admin board (specs/pix-payments.md §7).
export async function BudgetTab({
  event,
  viewerId,
  isAdmin,
  participants,
  items,
  chargeSettings,
  charges,
}: {
  event: EventRow;
  viewerId: string;
  isAdmin: boolean;
  participants: Participant[];
  items: BudgetItem[];
  chargeSettings: ChargeSettings | null;
  charges: PixChargeWithUser[];
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

  // The viewer's live (or kept paid) charge; refunded rows are history.
  // A pending one is reconciled against the PSP on the spot — the webhook
  // fallback (specs/pix-payments.md §5), and the only confirmation path in
  // local dev, which MP's webhooks can't reach.
  let myCharge =
    charges.find(
      (c) => c.user_id === viewerId && c.status !== "refunded"
    ) ?? null;
  if (myCharge?.status === "pending") {
    myCharge = await reconcileChargeWithPsp(myCharge);
  }

  // Budget-derived prices in the base − deductions shape the activation form
  // snapshots (specs/event-budget.md §5).
  const mapped = {
    baseCents: fullPrice,
    alcoholCents: shares.alcoholShare,
    meatCents: shares.meatShare,
  };
  // Never reprice silently — only surface the drift (specs/event-budget.md §6.3).
  const drift =
    chargeSettings !== null &&
    items.length > 0 &&
    (chargeSettings.base_price_cents !== mapped.baseCents ||
      chargeSettings.no_alcohol_deduction_cents !== mapped.alcoholCents ||
      chargeSettings.no_meat_deduction_cents !== mapped.meatCents);

  return (
    <>
      {chargeSettings && myCharge && (
        <PaymentCard
          eventId={event.id}
          charge={myCharge}
          settings={chargeSettings}
          flags={viewerFlags}
        />
      )}

      {isAdmin && !chargeSettings && (
        <Card className="gap-3 p-4">
          <h2 className="font-medium">Charging</h2>
          {event.status === "finalized" ? (
            <ActivateChargingForm
              eventId={event.id}
              participants={participants.map((p) => ({
                userId: p.userId,
                name: p.name,
                email: p.email,
                noAlcohol: p.noAlcohol,
                noMeat: p.noMeat,
              }))}
              prefill={items.length > 0 ? mapped : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Finalize a data primeiro — cobranças só podem ser ativadas com o
              evento finalizado.
            </p>
          )}
        </Card>
      )}

      {isAdmin && chargeSettings && (
        <Card className="gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Payments</h2>
            <div className="flex items-center gap-2">
              <form action={syncChargeStatuses.bind(null, event.id)}>
                <Button type="submit" size="xs" variant="outline">
                  Sync statuses
                </Button>
              </form>
              <ConfirmActionButton
                action={deactivateCharging.bind(null, event.id)}
                title="Deactivate charging?"
                description="Every unpaid charge is canceled — the Pix codes stop working. Paid charges are kept; refunds stay manual. Reactivating later creates fresh charges for anyone who hasn't paid."
                confirmLabel="Deactivate"
              >
                Deactivate
              </ConfirmActionButton>
            </div>
          </div>
          {drift && (
            <p className="text-sm text-warning-foreground">
              O orçamento mudou desde a ativação — desative e reative a
              cobrança para reprecificar.
            </p>
          )}
          <PaymentBoard
            eventId={event.id}
            participants={participants}
            charges={charges}
          />
        </Card>
      )}

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
