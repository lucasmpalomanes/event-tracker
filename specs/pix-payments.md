# Pix Payments — Specification

**Status:** Draft v1
**Last updated:** 2026-07-08
**Amends:** [`spec.md`](./spec.md) §2 listed "payments" as a v1 non-goal; this
spec introduces them as a follow-up feature. Everything in `spec.md` (roles,
memberships, event lifecycle) still applies unless stated otherwise here.

## 1. Overview

Once an event's date is finalized, the admin can activate a **Pix charge** for
it. The app creates one **dynamic Pix charge per approved participant** through
a PSP's Pix API; each participant sees their own copia-e-cola code (and QR) on
the event page and pays from their own bank app. The PSP notifies the app via
**webhook** when a payment lands, so each participant's status flips to "paid"
automatically — no manual bank-statement reconciliation.

Each participant's amount is derived from **consumption flags** they set on
their membership (doesn't drink alcohol, doesn't eat meat): a base price minus
per-flag deductions. The admin can type these prices in by hand, or — once the
**budget tab** exists ([`event-budget.md`](./event-budget.md)) — have them
prefilled from the event's itemized costs.

## 2. Goals & non-goals

### Goals
- Admin activates a charge on a **finalized** event, setting a base price and
  per-flag deductions.
- Participants declare consumption flags (no alcohol / no meat) on their
  membership.
- One dynamic Pix charge (unique `txid`) per approved participant, created via
  a PSP API; the participant gets a copia-e-cola string and QR code.
- Webhook-driven confirmation: payment status updates without admin action.
- Admin sees a per-participant payment board (paid / pending / expired) and has
  a **manual "mark as paid" override** as a fallback (webhook missed, paid in
  cash, etc.).

### Non-goals (this version)
- The **budget tab** that computes prices from itemized costs — specced
  separately in [`event-budget.md`](./event-budget.md); this spec only
  defines the flags/pricing model it feeds.
- Automatic **refunds** (Pix devolution). If someone overpays or the event is
  cancelled, the admin refunds manually from their bank app — the app only
  **records** that it happened (the `refunded` status, [§4](#4-data-model)),
  it never moves money back itself.
- Charging users who are not approved members, or public payment links.
- Partial payments or installments — one charge, one full payment.
- Collecting the payer's **CPF**. Reconciliation is by `txid`, which the app
  generates and maps to a user; the optional `devedor` field on the charge is
  left empty (resolved decision, [§9](#9-resolved-decisions)).
- Multiple receiving accounts — all charges settle into the single Pix account
  configured for the deployment.

## 3. Roles & permissions

| Role | Can do |
|------|--------|
| **Admin** | Activate/deactivate charging on a finalized event; set base price and deductions; edit any participant's flags (regenerates their unpaid charge); mark a charge as paid manually; cancel a participant's charge. |
| **Participant** (approved member) | Set their own consumption flags **until charging is activated**; view their own charge (amount, copia-e-cola, QR, status); regenerate their own expired charge. |
| **Anonymous / non-member** | Nothing — payment data is behind the same membership gate as the date page. |

All writes go through server actions / route handlers that re-check the Auth0
session and role, exactly like the rest of the app (`spec.md` §6).

## 4. Data model

### `event_memberships` — new columns
Consumption flags are per-membership (the same person might opt out of drinking
at one event only). Self-declared by the participant; editable by admins.
- `no_alcohol` (bool, default false)
- `no_meat` (bool, default false)

**Editing window:** the participant may edit their own flags while the event
has no active charge. Once charging is activated, only an admin can change a
flag — and doing so cancels and regenerates that participant's charge if it
isn't paid yet (a paid charge is never regenerated; the admin settles
differences out-of-band).

### `event_charge_settings`
One row per event, created when the admin activates charging. Existence of the
row = charging is active.
- `event_id` (fk → events.id, pk, on delete cascade)
- `base_price_cents` (int, > 0)
- `no_alcohol_deduction_cents` (int, ≥ 0, default 0)
- `no_meat_deduction_cents` (int, ≥ 0, default 0)
- `created_at`, `updated_at`
- **Validation:** `base_price_cents - no_alcohol_deduction_cents -
  no_meat_deduction_cents > 0` (deductions compose; a fully-deducted
  participant must still owe a positive amount — if someone owes nothing, the
  admin just cancels their charge instead).

A participant's amount is derived, never stored as the source of truth:

```
amount = base_price
       - (no_alcohol ? no_alcohol_deduction : 0)
       - (no_meat    ? no_meat_deduction    : 0)
```

The admin confirms these three numbers in the activation form — typed by hand,
or prefilled from the budget tab when the event has budget items
([`event-budget.md`](./event-budget.md) §5–6; same columns either way).

### `pix_charges`
One row per (event, participant) charge. The snapshot of `amount_cents` at
creation time is what the PSP charge was created with — repricing requires
regeneration.
- `id` (uuid, pk)
- `event_id` (fk → events.id, on delete cascade)
- `user_id` (fk → users.id, on delete cascade)
- `txid` (text, unique) — generated by the app (26–35 alphanum chars per the
  BCB spec), the reconciliation key
- `psp_charge_id` (text, nullable) — the PSP's own identifier, if distinct
- `amount_cents` (int)
- `brcode` (text) — the copia-e-cola payload returned by the PSP
- `status` (enum: `pending` | `paid` | `expired` | `canceled` | `refunded`)
- `paid_at` (timestamptz, nullable)
- `refunded_at` (timestamptz, nullable)
- `paid_manually` (bool, default false) — true when an admin used the manual
  override instead of the webhook
- `expires_at` (timestamptz) — mirrors the PSP charge's expiration
- `created_at`, `updated_at`
- **Unique partial constraint:** one **live** charge (status not in
  `canceled`, `refunded`) per (`event_id`, `user_id`) — history of
  canceled/regenerated/refunded charges is kept.

**Status transitions**
- `pending → paid` — webhook, or admin manual override.
- `pending → expired` — `expires_at` passes without payment (checked lazily on
  read; no cron). An expired charge can be **regenerated** (new row, new txid,
  old row → `canceled`) by the participant or admin.
- `pending → canceled` — admin cancels, admin edits flags (regeneration),
  the participant is removed from the event ([§6](#6-lifecycle--rules)), or
  charging is deactivated.
- `paid → refunded` — admin-only, **after** having sent the money back
  manually from their bank app (the app never moves money; this is
  bookkeeping). Confirmation required. Sets `refunded_at`.
- `refunded` is terminal. `paid` is terminal except for the refund marking
  above.

## 5. PSP integration

The PSP is **Mercado Pago** (decision rationale in [§9](#9-resolved-decisions)).
The app talks to it through a thin adapter in `lib/pix.ts` exposing exactly
three operations:

1. `createCharge({ txid, amountCents, payerEmail })` →
   `{ brcode, pspChargeId, expiresAt }` — creates an immediate dynamic
   charge. The `devedor` field is **not** sent.
2. `cancelCharge(pspChargeId)` — marks the PSP-side charge as removed, where
   the PSP supports it (best-effort; the local row is canceled regardless).
3. `verifyWebhook(request)` → `{ orderId } | reject` — authenticates an
   incoming webhook call; the payment's truth is then read back with
   `getChargeStatus(pspChargeId)` (MP's webhook only says "something
   changed").

Keeping every PSP-specific detail (auth, payload shapes) behind this adapter
means switching PSPs is a one-file change.

**Mercado Pago mapping** (inside the adapter; switched from the legacy
Payments API to the **Orders API** on 2026-07-09 — MP marks Payments as
"versão anterior" for new integrations):
- A charge is an order: `POST /v1/orders` with `type: "online"`,
  `processing_mode: "automatic"` and one Pix transaction
  (`payment_method: { id: "pix", type: "bank_transfer" }`). Mercado Pago is
  not the BCB-standard Pix API, so our `txid` travels in
  **`external_reference`**; MP's order id (`ORD…`) is stored as
  `psp_charge_id` (and is what webhook payloads carry as `data.id` — the
  adapter resolves it back to the charge).
- MP requires the **payer's email** on the order; we send the participant's
  account email (still no CPF/`devedor`).
- The copia-e-cola payload comes back in
  `transactions.payments[].payment_method.qr_code` → our `brcode`.
- Expiration via `expiration_time` (ISO-8601 duration, `P7D`).
- Cancelation via `POST /v1/orders/{id}/cancel` (only while unpaid). Paid =
  order `status: "processed"`, read back with `GET /v1/orders/{id}`.
- Auth is a server-side **access token** — no client certificate. Sandbox:
  MP test credentials point a dev deployment at a parallel test environment;
  in dev the adapter sends `payer.first_name: "APRO"`, the magic value that
  makes the test environment auto-approve the payment.
- Funds settle in the Mercado Pago account; moving them to a bank account is
  a manual (free) withdrawal, outside the app.

**Charge parameters:** expiration **7 days** from creation. Fixed amount (the
payer cannot alter it). No `devedor`.

**Webhook endpoint:** a route handler at `/api/pix/webhook`.
- Authenticates the caller by validating Mercado Pago's **`x-signature`
  header** (HMAC over the notification's timestamp + id, using the webhook
  secret from the MP dashboard, kept in an env var). Requests failing
  validation get a 401 and are logged.
- Looks up the charge by `txid`; unknown txids are acknowledged and ignored
  (200, so the PSP stops retrying) but logged.
- Sets `status = paid`, `paid_at` from the payload. **Idempotent:** a webhook
  for an already-`paid` charge is a no-op. A webhook for a locally-`expired`
  or `canceled` charge still marks it `paid` (the money arrived; local state
  was stale) and flags it for admin attention.
- This is the **one path that doesn't go through Auth0** — it authenticates the
  PSP, not a user.
- **Query fallback** *(added 2026-07-09)*: a viewer's own `pending` charge is
  reconciled against the PSP on page load, and the admin board has a "sync
  statuses" action doing the same for all pending charges. Covers webhook
  misses in production and local dev, where MP's webhooks can't reach the
  app.

**Credentials** live in env vars (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`),
server-side only, same posture as the Supabase secret key. Test credentials
in `.env.local`, production credentials on Vercel.

## 6. Lifecycle & rules

**Activation** (admin, on the date page of a `finalized` event)
1. Admin opens "Ativar cobrança", enters base price + deductions, sees a
   preview of each participant's computed amount, confirms.
2. The app creates `event_charge_settings` and one `pix_charges` row (+ PSP
   charge) per **currently approved** participant — including the admin
   themself, whose charge the admin will typically mark paid or cancel.
3. Members approved **after** activation get their charge created automatically
   at approval time, priced by the current settings and their flags.

**Only finalized events.** Charging can only be activated on a `finalized`
event — collecting money only makes sense once the date is set.

**Participant removal with an active charge.** Removal is allowed on any
event status, including `finalized` (`spec.md` §5.3) — someone can change
their mind about attending after seeing the chosen date. When the admin
removes a participant from an event with active charging:
- Their `pending`/`expired` charge is **canceled** (PSP-side best-effort,
  local row → `canceled`).
- A **`paid` charge is kept** — money already moved. The removal confirmation
  warns the admin that any refund is a manual Pix from their bank app. The
  payment board keeps showing the paid row under a "removed" marker so the
  collected total stays honest. After refunding out-of-band, the admin marks
  the charge **`refunded`**, which removes its amount from the collected
  total ([§7.2](#72-admin-view-same-page-additionally)).
- If a removed user later re-requests and is re-approved: with a kept `paid`
  charge, **no new charge is created** (they already paid — the one live
  charge per (event, user) constraint enforces this naturally). If their
  charge was marked `refunded`, they get a **fresh charge** like any
  post-activation approval — the money went back, so they owe again.

**Deactivation.** The admin can deactivate charging (deletes
`event_charge_settings`, cancels all `pending`/`expired` charges). `paid`
charges are **kept** — money already moved; the admin handles refunds
out-of-band. Reactivating later starts fresh for anyone without a paid charge.

**Editing prices after activation** is not supported in v1 — deactivate and
reactivate instead (the confirmation dialog says exactly this). This keeps
"what was each person charged" trivially answerable.

**Event deletion** cascades charges away locally; PSP-side charges are
best-effort canceled first. Deleting an event with paid charges warns the
admin.

## 7. Screens

All payment UI lives on the event page (`/events/[id]`), which is already
membership-gated — specifically in its **Budget tab**
([`event-budget.md`](./event-budget.md) §6, which reorganized the page into
Dates/Budget tabs and relocated the UI described below there). **Nothing
changes on the main event list** — a "pagamento pendente" badge there was
considered and rejected ([§9](#9-resolved-decisions)); payment status lives
only in the Budget tab.

### 7.1 Participant view (finalized event, charging active)

A **payment card** at the top of the Budget tab:
- Their computed amount with a breakdown line when a deduction applies
  ("R$ 60 − R$ 15 (não bebe) = R$ 45").
- The **copia-e-cola** string with a copy button, and the QR code rendered
  from the same brcode (for the two-phones case).
- Status: pending (with expiry countdown), paid ✓ (with date), expired (with a
  "Gerar novo código" button that regenerates).
- Before charging is activated (any event status): a small **flags editor** on
  their own membership — "não bebo álcool" / "não como carne" toggles. Copy
  makes clear this affects how much they'll pay.

### 7.2 Admin view (same page, additionally)

- **Activate charging** (finalized events only): form with base price + two
  deductions, live per-participant amount preview, confirmation.
- **Payment board:** every approved participant with flags, amount, status,
  paid date — plus kept rows of removed participants, under a "removed"
  marker. Row actions: mark as paid (confirmation; records `paid_manually`),
  mark as refunded (paid rows only; confirmation states the admin already
  sent the money back), cancel charge, regenerate, edit flags (warns it
  regenerates an unpaid charge).
- Totals: **collected** (sum of `paid` — a `refunded` charge leaves this
  total) / outstanding / refunded (shown only when > 0).
- **Deactivate charging** (confirmation spells out what gets canceled and that
  paid rows are kept).

## 8. Open questions

None at the moment — the PSP choice, sandbox strategy, and list-badge
questions were all resolved on 2026-07-08 (see [§9](#9-resolved-decisions)).

## 9. Resolved decisions

- **PSP = Mercado Pago** *(2026-07-08)*. Compared against Efí and Asaas for a
  pessoa-física account receiving small per-person charges on Vercel:
  - **Mercado Pago:** 0.99% per Pix (≈ R$ 0.50 on a R$ 50 charge), access
    token only, `x-signature` HMAC webhook (serverless-friendly), test
    credentials for sandbox. Chosen.
  - **Efí:** true BCB Pix API and funds land in one's own account, but 1.19%,
    requires an Efí Pro account + `.p12` client certificate, and its webhook
    wants mTLS — the skip-mTLS + HMAC mode exists but Efí itself flags it as
    homologation-grade.
  - **Asaas:** integration as simple as MP (header token webhook, separate
    sandbox), but a **flat R$ 1.99** per paid dynamic-QR charge (R$ 0.99 in
    the first 3 months) — ≈ 4% at churrasco-sized values; only competitive
    above ~R$ 200/person. The PF free tier covers static QR only.

  The `lib/pix.ts` adapter (§5) keeps this swappable if fees or requirements
  change.
- **No "pagamento pendente" badge on the main event list** *(2026-07-08)* —
  the list stays payment-free; status lives only in the Budget tab. Cheaper
  listing query, and reminders are future work anyway.
- **Dynamic charge per participant, reconciled by `txid`** — not one shared
  static code. The app generates the txid and maps it to a user, so we know
  who paid without collecting anyone's CPF. *(2026-07-08)*
- **No CPF collection.** The Pix `devedor` field is optional and cosmetic; we
  leave it empty. The payer's identity is handled by their own bank.
  *(2026-07-08)*
- **Confirmation is automatic via PSP webhook**, with a manual admin override
  as fallback — not statement-checking as the primary flow. *(2026-07-08)*
- **Charging only on finalized events.** Matches the real flow: pick the
  date, then collect. *(2026-07-08)*
- **Removal composes with charges** *(2026-07-08)*: removing a participant
  (allowed on finalized events per `spec.md` §5.3, revised same date) cancels
  their unpaid charge; a paid charge is kept for the record, with refunds
  manual. A re-approved user with a kept paid charge is not charged again.
- **Pricing = base − flag deductions**, admin-entered in v1, computed by the
  future budget tab later. Flags live on `event_memberships` (per-event, not
  per-user). *(2026-07-08)*
- **Repricing = regeneration.** A charge's amount is immutable; flag or price
  changes cancel and recreate unpaid charges. Paid charges are never touched.
  *(2026-07-08)*
- **Refunds are manual but tracked** *(2026-07-08)*: the admin sends the Pix
  back from their bank app, then marks the charge `refunded` in the app. The
  amount leaves the collected total, and a re-approved user whose charge was
  refunded is charged again (unlike one whose paid charge was kept).

## 10. Future work

- ~~Budget tab ("orçamento")~~ — now specced in
  [`event-budget.md`](./event-budget.md) *(2026-07-08)*.
- **Automatic refunds** via the PSP's devolution API (event canceled,
  overpayment).
- **Payment reminders** — depends on notifications, itself future work in
  `spec.md` §9.
- **Zero-amount participants:** allow a fully-exempt participant (amount = 0)
  to be auto-marked as settled instead of requiring the admin to cancel their
  charge.
