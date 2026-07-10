import QRCode from "qrcode";
import { regenerateMyCharge } from "@/app/actions";
import type { ChargeSettings, ConsumptionFlags } from "@/lib/budget";
import type { PixCharge } from "@/lib/charges";
import { formatBRL, formatDay } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "./copy-button";

// The participant's own payment card (specs/pix-payments.md §7.1): amount
// with a breakdown when a deduction applies, the copia-e-cola + QR while
// pending, status otherwise.
export async function PaymentCard({
  eventId,
  charge,
  settings,
  flags,
}: {
  eventId: string;
  charge: PixCharge;
  settings: ChargeSettings;
  flags: ConsumptionFlags;
}) {
  const { t, locale } = await getT("payment");
  const { t: tBudget } = await getT("budget");

  // "R$ 60 − R$ 15 (não bebe) = R$ 45" — deductions come from the frozen
  // settings, so they always add up to the charge's snapshot amount.
  const deductions = [
    flags.no_alcohol && settings.no_alcohol_deduction_cents > 0
      ? tBudget("breakdown.noAlcohol", {
          amount: formatBRL(settings.no_alcohol_deduction_cents),
        })
      : null,
    flags.no_meat && settings.no_meat_deduction_cents > 0
      ? tBudget("breakdown.noMeat", {
          amount: formatBRL(settings.no_meat_deduction_cents),
        })
      : null,
  ].filter(Boolean);

  const qrDataUrl =
    charge.status === "pending"
      ? await QRCode.toDataURL(charge.brcode, { width: 220, margin: 1 })
      : null;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">{t("yourPayment")}</h2>
        {charge.status === "pending" && (
          <span className="text-xs text-muted-foreground">
            {t("expiresOn", {
              date: formatDay(charge.expires_at.slice(0, 10), locale),
            })}
          </span>
        )}
      </div>

      <p className="text-lg font-semibold">
        {deductions.length > 0 ? (
          <>
            <span className="font-normal text-muted-foreground">
              {formatBRL(settings.base_price_cents)} {deductions.join(" ")} ={" "}
            </span>
            {formatBRL(charge.amount_cents)}
          </>
        ) : (
          formatBRL(charge.amount_cents)
        )}
      </p>

      {charge.status === "pending" && qrDataUrl && (
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img
            src={qrDataUrl}
            alt={t("qrAlt")}
            className="size-40 rounded-md border bg-white"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {t("instructions")}
            </p>
            <code className="max-h-24 overflow-y-auto break-all rounded-md bg-muted p-2 text-xs">
              {charge.brcode}
            </code>
            <CopyButton value={charge.brcode} />
          </div>
        </div>
      )}

      {charge.status === "paid" && (
        <p className="text-sm">
          <Badge>{t("paidBadge")}</Badge>{" "}
          <span className="text-muted-foreground">
            {charge.paid_at
              ? t("paidOn", {
                  date: formatDay(charge.paid_at.slice(0, 10), locale),
                })
              : "—"}
            {charge.paid_manually && ` ${t("paidManually")}`}
          </span>
        </p>
      )}

      {charge.status === "expired" && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">{t("expiredBadge")}</Badge>
          <form action={regenerateMyCharge.bind(null, eventId)}>
            <Button type="submit" size="xs" variant="outline">
              {t("regenerateMine")}
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
