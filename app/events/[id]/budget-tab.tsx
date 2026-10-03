import type { EventRow, Participant } from "@/lib/events";
import {
  amountFor,
  computeShares,
  formatBRL,
  hostAmount,
  type BudgetItem,
  type ChargeSettings,
} from "@/lib/budget";
import { companionsOf, type Companion } from "@/lib/companions";
import {
  reconcileChargeWithPsp,
  type PixChargeWithUser,
} from "@/lib/charges";
import { getT } from "@/lib/i18n/server";
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
import { CompanionsEditor } from "./companions-editor";
import { FlagsEditor } from "./flags-editor";
import { PaymentBoard } from "./payment-board";
import { PaymentCard } from "./payment-card";

// " (não bebe, não come carne)" markers next to a unit's name
// (specs/companions.md §7.1–7.4); empty for a unit with neither flag.
function flagsNote(
  noAlcohol: boolean,
  noMeat: boolean,
  t: (key: string) => string
): string {
  const notes = [
    noAlcohol ? t("marker.noAlcohol") : null,
    noMeat ? t("marker.noMeat") : null,
  ].filter(Boolean);
  return notes.length > 0 ? ` (${notes.join(", ")})` : "";
}

// The Budget tab (specs/event-budget.md §6): itemized costs, live per-person
// shares, the viewer's own flags + share, and — the money story — the Pix
// payment card, activation form and admin board (specs/pix-payments.md §7).
export async function BudgetTab({
  event,
  viewerId,
  isAdmin,
  participants,
  companions,
  items,
  chargeSettings,
  charges,
}: {
  event: EventRow;
  viewerId: string;
  isAdmin: boolean;
  participants: Participant[];
  companions: Companion[];
  items: BudgetItem[];
  chargeSettings: ChargeSettings | null;
  charges: PixChargeWithUser[];
}) {
  const { t } = await getT("budget");

  // The split's unit of account is the billable unit: one participant or one
  // companion (specs/companions.md §5).
  const shares = computeShares(items, [
    ...participants.map((p) => ({
      no_alcohol: p.noAlcohol,
      no_meat: p.noMeat,
    })),
    ...companions.map((c) => ({
      no_alcohol: c.no_alcohol,
      no_meat: c.no_meat,
    })),
  ]);

  const viewer = participants.find((p) => p.userId === viewerId);
  const viewerFlags = {
    no_alcohol: viewer?.noAlcohol ?? false,
    no_meat: viewer?.noMeat ?? false,
  };
  const myCompanions = companionsOf(companions, viewerId);
  // The headline is the host's total: own unit + one per companion (§7.1).
  const yourShare = hostAmount(
    shares,
    viewerFlags,
    myCompanions.map((c) => ({ no_alcohol: c.no_alcohol, no_meat: c.no_meat }))
  );
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
      ? t("breakdown.noAlcohol", { amount: formatBRL(shares.alcoholShare) })
      : null,
    viewerFlags.no_meat && shares.meatShare > 0
      ? t("breakdown.noMeat", { amount: formatBRL(shares.meatShare) })
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
  // Charging is off, yet unpaid charges linger — a broken invariant that
  // otherwise has no UI to clear it (specs/reopen-finalized.md §4).
  const orphanCharges =
    chargeSettings === null &&
    charges.some((c) => c.status === "pending" || c.status === "expired");

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
          companions={myCompanions}
        />
      )}

      {isAdmin && !chargeSettings && (
        <Card className="gap-3 p-4">
          <h2 className="font-medium">{t("charging")}</h2>
          {event.status === "finalized" ? (
            <ActivateChargingForm
              eventId={event.id}
              participants={participants.map((p) => ({
                userId: p.userId,
                name: p.name,
                email: p.email,
                noAlcohol: p.noAlcohol,
                noMeat: p.noMeat,
                // Priced into the host's single charge (specs/companions.md §7.3).
                companions: companionsOf(companions, p.userId).map((c) => ({
                  name: c.name,
                  noAlcohol: c.no_alcohol,
                  noMeat: c.no_meat,
                })),
              }))}
              prefill={items.length > 0 ? mapped : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("finalizeFirst")}
            </p>
          )}
          {/* Unpaid charges with no settings row shouldn't exist, but if they
              do, the payment board and its deactivate control are both hidden
              and the event can never reopen. Surface the one call that clears
              them (specs/reopen-finalized.md §4). */}
          {orphanCharges && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-warning-foreground">
                {t("orphanCharges")}
              </p>
              <ConfirmActionButton
                action={deactivateCharging.bind(null, event.id)}
                title={t("deactivate.title")}
                description={t("deactivate.description")}
                confirmLabel={t("deactivate.label")}
                className="self-start"
              >
                {t("deactivate.label")}
              </ConfirmActionButton>
            </div>
          )}
        </Card>
      )}

      {isAdmin && chargeSettings && (
        <Card className="gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{t("payments")}</h2>
            <div className="flex items-center gap-2">
              <form action={syncChargeStatuses.bind(null, event.id)}>
                <Button type="submit" size="xs" variant="outline">
                  {t("syncStatuses")}
                </Button>
              </form>
              <ConfirmActionButton
                action={deactivateCharging.bind(null, event.id)}
                title={t("deactivate.title")}
                description={t("deactivate.description")}
                confirmLabel={t("deactivate.label")}
              >
                {t("deactivate.label")}
              </ConfirmActionButton>
            </div>
          </div>
          {drift && (
            <p className="text-sm text-warning-foreground">{t("drift")}</p>
          )}
          <PaymentBoard
            eventId={event.id}
            participants={participants}
            companions={companions}
            charges={charges}
          />
        </Card>
      )}

      <Card className="gap-3 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">{t("items")}</h2>
          {items.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {t("total", { amount: formatBRL(shares.totalCents) })}
            </span>
          )}
        </div>
        {isAdmin ? (
          <BudgetItemsEditor eventId={event.id} items={editableItems} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="flex-1">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`exemption.${item.exemption}`)} ·{" "}
                  {t("groupSize", { count: groupSize[item.exemption] })}
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
          <h2 className="font-medium">{t("costSplit")}</h2>
          {/* Units, with the composition spelled out when companions exist
              (specs/companions.md §7.2). */}
          <p className="text-sm text-muted-foreground">
            {companions.length > 0 ? (
              <>
                {t("unitsTotal", { count: shares.headcount })} (
                {t("headcount", {
                  count: shares.headcount - companions.length,
                })}{" "}
                + {t("companionsCount", { count: companions.length })})
              </>
            ) : (
              t("headcount", { count: shares.headcount })
            )}{" "}
            · {t("drinkers", { count: shares.drinkers })} ·{" "}
            {t("meatEaters", { count: shares.meatEaters })}
          </p>
          {shares.unsplitAlcohol && (
            <p className="text-sm text-warning-foreground">
              {t("unsplitAlcohol")}
            </p>
          )}
          {shares.unsplitMeat && (
            <p className="text-sm text-warning-foreground">
              {t("unsplitMeat")}
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            <li className="flex justify-between">
              <span>{t("fullPrice")}</span>
              <span className="font-medium">{formatBRL(fullPrice)}</span>
            </li>
            <li className="flex justify-between">
              <span>{t("noAlcoholPrice")}</span>
              <span className="font-medium">
                {formatBRL(fullPrice - shares.alcoholShare)}
              </span>
            </li>
            <li className="flex justify-between">
              <span>{t("noMeatPrice")}</span>
              <span className="font-medium">
                {formatBRL(fullPrice - shares.meatShare)}
              </span>
            </li>
            <li className="flex justify-between">
              <span>{t("noAlcoholNoMeatPrice")}</span>
              <span className="font-medium">{formatBRL(shares.generalShare)}</span>
            </li>
          </ul>
        </Card>
      )}

      <Card className="gap-3 p-4">
        <h2 className="font-medium">
          {myCompanions.length > 0
            ? t("yourShareWithCompanions", { count: myCompanions.length })
            : t("yourShare")}
        </h2>
        {items.length > 0 ? (
          myCompanions.length > 0 ? (
            // Host total with the per-person breakdown (specs/companions.md §7.1).
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">{formatBRL(yourShare)}</p>
              <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                <li className="flex justify-between">
                  <span>
                    {t("you")}
                    {flagsNote(viewerFlags.no_alcohol, viewerFlags.no_meat, t)}
                  </span>
                  <span>{formatBRL(amountFor(shares, viewerFlags))}</span>
                </li>
                {myCompanions.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>
                      {c.name}
                      {flagsNote(c.no_alcohol, c.no_meat, t)}
                    </span>
                    <span>
                      {formatBRL(
                        amountFor(shares, {
                          no_alcohol: c.no_alcohol,
                          no_meat: c.no_meat,
                        })
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
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
          )
        ) : (
          <p className="text-sm text-muted-foreground">{t("noItemsShare")}</p>
        )}
        <Separator />
        <FlagsEditor
          eventId={event.id}
          noAlcohol={viewerFlags.no_alcohol}
          noMeat={viewerFlags.no_meat}
          chargingActive={chargeSettings !== null}
        />
        <Separator />
        {/* Same editing window as the flags (specs/companions.md §6): the
            editor while charging is inactive, a read-only list after. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("companions.title")}</h3>
          {chargeSettings === null ? (
            <CompanionsEditor
              eventId={event.id}
              companions={myCompanions.map((c) => ({
                id: c.id,
                name: c.name,
                noAlcohol: c.no_alcohol,
                noMeat: c.no_meat,
              }))}
            />
          ) : myCompanions.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {myCompanions
                .map((c) => `${c.name}${flagsNote(c.no_alcohol, c.no_meat, t)}`)
                .join(" · ")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("companions.none")}
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
