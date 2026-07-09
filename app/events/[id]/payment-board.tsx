import {
  adminSetConsumptionFlags,
  cancelParticipantCharge,
  markChargePaid,
  markChargeRefunded,
  regenerateParticipantCharge,
} from "@/app/actions";
import type { PixChargeWithUser } from "@/lib/charges";
import type { Participant } from "@/lib/events";
import { formatBRL } from "@/lib/format";
import { formatDay } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ConfirmActionButton } from "@/components/confirm-action-button";

function StatusBadge({ charge }: { charge: PixChargeWithUser }) {
  switch (charge.status) {
    case "paid":
      return (
        <Badge>
          Paid{charge.paid_manually ? " (manual)" : ""}
          {charge.paid_at ? ` · ${formatDay(charge.paid_at.slice(0, 10))}` : ""}
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline">
          Pending · expira {formatDay(charge.expires_at.slice(0, 10))}
        </Badge>
      );
    case "expired":
      return <Badge variant="outline">Expired</Badge>;
    case "refunded":
      return <Badge variant="outline">Refunded</Badge>;
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
}: {
  eventId: string;
  userId: string;
  who: string;
  flags: { noAlcohol: boolean; noMeat: boolean };
  flag: "noAlcohol" | "noMeat";
  hasUnpaidCharge: boolean;
}) {
  const current = flags[flag];
  const label =
    flag === "noAlcohol"
      ? current
        ? "não bebe"
        : "bebe"
      : current
        ? "não come carne"
        : "come carne";
  return (
    <ConfirmActionButton
      action={adminSetConsumptionFlags.bind(null, eventId, userId, {
        ...flags,
        [flag]: !current,
      })}
      title={`Change ${who}'s flags?`}
      description={
        hasUnpaidCharge
          ? "Their unpaid charge will be canceled and regenerated at the new amount (new Pix code)."
          : "This changes how much they owe on the next charge."
      }
      confirmLabel="Change"
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
export function PaymentBoard({
  eventId,
  participants,
  charges,
}: {
  eventId: string;
  participants: Participant[];
  charges: PixChargeWithUser[];
}) {
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
        {removed && <Badge variant="outline">removed</Badge>}
        {charge && <StatusBadge charge={charge} />}
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
            />
          </>
        )}
        {charge && (charge.status === "pending" || charge.status === "expired") && (
          <>
            <ConfirmActionButton
              action={markChargePaid.bind(null, eventId, charge.id)}
              title={`Mark ${who} as paid?`}
              description="Use this when the money arrived outside the Pix code — webhook missed, paid in cash. It is recorded as a manual override."
              confirmLabel="Mark paid"
              confirmVariant="default"
            >
              Mark paid
            </ConfirmActionButton>
            <form action={regenerateParticipantCharge.bind(null, eventId, charge.id)}>
              <Button type="submit" size="xs" variant="outline">
                Regenerate
              </Button>
            </form>
            <ConfirmActionButton
              action={cancelParticipantCharge.bind(null, eventId, charge.id)}
              title={`Cancel ${who}'s charge?`}
              description="They won't be able to pay this code anymore. You can regenerate later by editing their flags or reactivating."
              confirmLabel="Cancel charge"
            >
              Cancel
            </ConfirmActionButton>
          </>
        )}
        {charge && charge.status === "paid" && (
          <ConfirmActionButton
            action={markChargeRefunded.bind(null, eventId, charge.id)}
            title={`Mark ${who} as refunded?`}
            description="Only confirm after sending the money back manually from your bank app — the app never moves money. The amount leaves the collected total."
            confirmLabel="Mark refunded"
          >
            Mark refunded
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
          <span>Collected</span>
          <span className="font-medium">{formatBRL(collected)}</span>
        </li>
        <li className="flex justify-between">
          <span>Outstanding</span>
          <span className="font-medium">{formatBRL(outstanding)}</span>
        </li>
        {refunded > 0 && (
          <li className="flex justify-between text-muted-foreground">
            <span>Refunded</span>
            <span>{formatBRL(refunded)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
