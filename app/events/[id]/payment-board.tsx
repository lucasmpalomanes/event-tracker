import type { TFunction } from "i18next";
import {
  adminSetConsumptionFlags,
  cancelParticipantCharge,
  markChargePaid,
  markChargeRefunded,
  regenerateParticipantCharge,
} from "@/app/actions";
import type { PixChargeWithUser } from "@/lib/charges";
import type { Participant } from "@/lib/events";
import { formatBRL, formatDay } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ConfirmActionButton } from "@/components/confirm-action-button";

function StatusBadge({
  charge,
  t,
  locale,
}: {
  charge: PixChargeWithUser;
  t: TFunction<"payment">;
  locale: Locale;
}) {
  switch (charge.status) {
    case "paid":
      return (
        <Badge>
          {t("status.paid")}
          {charge.paid_manually ? ` ${t("status.manual")}` : ""}
          {charge.paid_at
            ? ` · ${formatDay(charge.paid_at.slice(0, 10), locale)}`
            : ""}
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline">
          {t("status.pending", {
            date: formatDay(charge.expires_at.slice(0, 10), locale),
          })}
        </Badge>
      );
    case "expired":
      return <Badge variant="outline">{t("status.expired")}</Badge>;
    case "refunded":
      return <Badge variant="outline">{t("status.refunded")}</Badge>;
    default:
      return null;
  }
}

// One admin flag toggle: confirmation warns that an unpaid charge gets
// regenerated at the new amount (specs/pix-payments.md §7.2).
function FlagToggle({
  eventId,
  userId,
  who,
  flags,
  flag,
  hasUnpaidCharge,
  t,
}: {
  eventId: string;
  userId: string;
  who: string;
  flags: { noAlcohol: boolean; noMeat: boolean };
  flag: "noAlcohol" | "noMeat";
  hasUnpaidCharge: boolean;
  t: TFunction<"payment">;
}) {
  const current = flags[flag];
  const label =
    flag === "noAlcohol"
      ? current
        ? t("flags.noDrinks")
        : t("flags.drinks")
      : current
        ? t("flags.noMeat")
        : t("flags.eatsMeat");
  return (
    <ConfirmActionButton
      action={adminSetConsumptionFlags.bind(null, eventId, userId, {
        ...flags,
        [flag]: !current,
      })}
      title={t("changeFlags.title", { name: who })}
      description={
        hasUnpaidCharge
          ? t("changeFlags.regenDescription")
          : t("changeFlags.nextDescription")
      }
      confirmLabel={t("changeFlags.confirm")}
      confirmVariant="default"
      variant="ghost"
      className="text-muted-foreground"
    >
      {label}
    </ConfirmActionButton>
  );
}

// Admin payment board (specs/pix-payments.md §7.2): every approved
// participant with flags, amount, status and row actions, plus kept rows of
// removed participants and the collected / outstanding / refunded totals.
export async function PaymentBoard({
  eventId,
  participants,
  charges,
}: {
  eventId: string;
  participants: Participant[];
  charges: PixChargeWithUser[];
}) {
  const { t, locale } = await getT("payment");

  const participantIds = new Set(participants.map((p) => p.userId));
  const liveByUser = new Map(
    charges
      .filter((c) => c.status !== "refunded")
      .map((c) => [c.user_id, c] as const)
  );
  // Paid/refunded rows of people no longer in the event stay on the board
  // under a "removed" marker so the totals stay honest (§6).
  const removedCharges = charges.filter((c) => !participantIds.has(c.user_id));

  const sum = (statuses: PixChargeWithUser["status"][]) =>
    charges
      .filter((c) => statuses.includes(c.status))
      .reduce((total, c) => total + c.amount_cents, 0);
  const collected = sum(["paid"]);
  const outstanding = sum(["pending", "expired"]);
  const refunded = sum(["refunded"]);

  const row = (
    charge: PixChargeWithUser | null,
    who: string,
    flags: { noAlcohol: boolean; noMeat: boolean } | null,
    userId: string,
    removed: boolean
  ) => (
    <li
      key={`${userId}-${charge?.id ?? "none"}`}
      className="flex flex-col gap-1 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{who}</span>
        {removed && <Badge variant="outline">{t("removed")}</Badge>}
        {charge && <StatusBadge charge={charge} t={t} locale={locale} />}
        <span className="ms-auto font-medium">
          {charge ? formatBRL(charge.amount_cents) : "—"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {flags && (
          <>
            <FlagToggle
              eventId={eventId}
              userId={userId}
              who={who}
              flags={flags}
              flag="noAlcohol"
              hasUnpaidCharge={
                charge?.status === "pending" || charge?.status === "expired"
              }
              t={t}
            />
            <FlagToggle
              eventId={eventId}
              userId={userId}
              who={who}
              flags={flags}
              flag="noMeat"
              hasUnpaidCharge={
                charge?.status === "pending" || charge?.status === "expired"
              }
              t={t}
            />
          </>
        )}
        {charge && (charge.status === "pending" || charge.status === "expired") && (
          <>
            <ConfirmActionButton
              action={markChargePaid.bind(null, eventId, charge.id)}
              title={t("markPaid.title", { name: who })}
              description={t("markPaid.description")}
              confirmLabel={t("markPaid.confirm")}
              confirmVariant="default"
            >
              {t("markPaid.label")}
            </ConfirmActionButton>
            <form action={regenerateParticipantCharge.bind(null, eventId, charge.id)}>
              <Button type="submit" size="xs" variant="outline">
                {t("regenerate")}
              </Button>
            </form>
            <ConfirmActionButton
              action={cancelParticipantCharge.bind(null, eventId, charge.id)}
              title={t("cancelCharge.title", { name: who })}
              description={t("cancelCharge.description")}
              confirmLabel={t("cancelCharge.confirm")}
            >
              {t("cancelCharge.label")}
            </ConfirmActionButton>
          </>
        )}
        {charge && charge.status === "paid" && (
          <ConfirmActionButton
            action={markChargeRefunded.bind(null, eventId, charge.id)}
            title={t("markRefunded.title", { name: who })}
            description={t("markRefunded.description")}
            confirmLabel={t("markRefunded.confirm")}
          >
            {t("markRefunded.label")}
          </ConfirmActionButton>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y">
        {participants.map((p) =>
          row(
            liveByUser.get(p.userId) ?? null,
            p.name ?? p.email,
            { noAlcohol: p.noAlcohol, noMeat: p.noMeat },
            p.userId,
            false
          )
        )}
        {removedCharges.map((c) =>
          row(c, c.userName ?? c.userEmail, null, c.user_id, true)
        )}
      </ul>
      <Separator />
      <ul className="flex flex-col gap-1 text-sm">
        <li className="flex justify-between">
          <span>{t("totals.collected")}</span>
          <span className="font-medium">{formatBRL(collected)}</span>
        </li>
        <li className="flex justify-between">
          <span>{t("totals.outstanding")}</span>
          <span className="font-medium">{formatBRL(outstanding)}</span>
        </li>
        {refunded > 0 && (
          <li className="flex justify-between text-muted-foreground">
            <span>{t("totals.refunded")}</span>
            <span>{formatBRL(refunded)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
