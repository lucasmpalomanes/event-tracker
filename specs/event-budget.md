# Event Budget ("Orçamento") — Specification

**Status:** Draft v1
**Last updated:** 2026-07-08
**Amends:**
- [`spec.md`](./spec.md) §5.2 — the date page's content below the event header
  is reorganized into **tabs**; the calendar/voting/ranking UI becomes the
  "Dates" tab.
- [`pix-payments.md`](./pix-payments.md) — the budget tab it listed as future
  work is this spec. Payment UI moves into the Budget tab, and the charge
  activation form is **prefilled** from the budget instead of hand-typed.

## 1. Overview

The Budget tab lets the admin itemize an event's costs (meat, drinks,
charcoal, ice, …), tag each item with **who shares it** (everyone / drinkers
only / meat-eaters only), and see the resulting per-person amounts computed
live from the approved participants and their consumption flags
(`no_alcohol` / `no_meat`, from `pix-payments.md` §4).

When the event is finalized and the admin activates charging, the Pix
activation form comes **prefilled** with the budget-derived base price and
deductions — closing the loop that `pix-payments.md` left open (admin typed
those three numbers by hand).

## 2. Goals & non-goals

### Goals
- Admin CRUD on budget line items, each tagged with an exemption group.
- Live per-person computation: every approved participant sees the total cost
  and **their own share**, given their flags.
- One-click bridge into Pix charging: activation prefilled from the budget
  (still editable before confirming).
- The event page reorganized into **Dates** and **Budget** tabs (shadcn/ui
  Tabs) below the event header.

### Non-goals (this version)
- Item quantities, unit prices, or per-item notes — one name + one total per
  line.
- Tracking who actually bought what, or reimbursing a participant who paid
  for an item (the model assumes the admin fronts all costs and collects).
- Custom exemption groups beyond the two existing flags (e.g. "vegans",
  "arrived late") — the enum can grow later.
- Automatic **repricing** of active charges when the budget changes — pricing
  is frozen at activation (`pix-payments.md` §6); the Budget tab only warns
  about drift.

## 3. Roles & permissions

| Role | Can do |
|------|--------|
| **Admin** | Add/edit/remove budget items (any event status). Activate charging from the budget (finalized events, per `pix-payments.md`). Everything a participant can. |
| **Participant** (approved member) | View the Budget tab read-only: items, totals, group sizes, and their own computed share. |
| **Non-member** | Nothing — the Budget tab sits behind the same membership gate as the rest of the event page. |

## 4. Data model

### `budget_items`
- `id` (uuid, pk)
- `event_id` (fk → events.id, on delete cascade)
- `name` (text, non-empty)
- `amount_cents` (int, > 0) — the item's **total** cost
- `exemption` (enum: `none` | `alcohol` | `meat`) — which flag exempts a
  participant from sharing this item: `none` = everyone splits it, `alcohol`
  = only drinkers (`no_alcohol = false`) split it, `meat` = only meat-eaters
  (`no_meat = false`) split it
- `created_at`, `updated_at`

Items are ordered by `created_at`. No soft delete.

## 5. Computation

All figures derive live from the current **approved** participants (including
the event creator) and their membership flags. Nothing here is persisted —
persistence happens only when the admin activates charging, which snapshots
the values into `event_charge_settings` (`pix-payments.md` §4).

**Groups**

| Group | Members | Size |
|---|---|---|
| everyone | all approved participants | `N` |
| drinkers | `no_alcohol = false` | `Nd` |
| meat-eaters | `no_meat = false` | `Nm` |

**Per-group shares** (integer cents, **rounded up** so the sum collected
covers the cost — any leftover cents stay with the admin):

```
s_general = ceil( Σ amount(exemption = none)    / N  )
s_alcohol = Nd > 0 ? ceil( Σ amount(exemption = alcohol) / Nd ) : 0
s_meat    = Nm > 0 ? ceil( Σ amount(exemption = meat)    / Nm ) : 0
```

**Per-person amount:** `s_general + (drinks ? s_alcohol : 0) + (eats meat ?
s_meat : 0)`.

**Mapping to charge settings** — this is exactly the base − deductions model
`pix-payments.md` defined, so the bridge is a straight assignment:

```
base_price_cents             = s_general + s_alcohol + s_meat
no_alcohol_deduction_cents   = s_alcohol
no_meat_deduction_cents      = s_meat
```

**Edge cases**
- Alcohol-tagged items but `Nd = 0` (nobody drinks): the tab shows a warning
  — that cost has no one to split it — and the share counts as 0. Same for
  meat. The admin fixes it by retagging the item to `none` or removing it.
- **A both-flags participant owes `s_general`.** The Pix validation
  (`base − both deductions > 0`) therefore requires `s_general > 0`: with no
  `none`-tagged items, activation from the budget is **blocked** with an
  explanation ("adicione um item que todos dividem, ou trate os isentos
  manualmente"). Auto-settling zero-amount participants remains future work
  in `pix-payments.md` §10.

## 6. Screens

### 6.1 Event page tab structure (amends `spec.md` §5.2)

The event page keeps its header untouched: back link, title + status badge,
description, location, "Edit details". **Below the header**, all remaining
content moves into a **shadcn/ui Tabs** component with two tabs:

- **Dates** (default) — everything the page shows today: the availability
  calendar, admin voting controls (auto-approve toggle, close voting, delete
  event), and the "Most voted days" ranking panel. No behavior changes.
- **Budget** — this spec.

The active tab is reflected in the URL (`?tab=budget`) so links land on the
right tab. Both tabs render for every event status — budgeting can start
while voting is still open.

### 6.2 Budget tab — participant view

- **Items table** (read-only): name, amount, who splits it ("Everyone" /
  "Drinkers" / "Meat-eaters"), with the group sizes shown (e.g.
  "Drinkers · 6 people").
- **Summary:** total cost, and a per-profile amount matrix (full / no
  alcohol / no meat / both) so the flag consequences are visible.
- **"Your share"** highlighted, computed from the viewer's own flags, with
  the same breakdown line format as the payment card ("R$ 60 − R$ 15 (não
  bebe) = R$ 45").
- The **flags editor** ("não bebo álcool" / "não como carne" toggles,
  `pix-payments.md` §7.1) sits right next to "your share", so toggling a flag
  visibly updates the amount. Editable at **any event status** until charging
  is activated (`pix-payments.md` §4); after that it renders read-only with a
  note to talk to the admin.
- Once charging is active, the participant's **payment card**
  (`pix-payments.md` §7.1 — copia-e-cola, QR, status) renders here, at the
  top of the tab. *(Amends `pix-payments.md` §7, which placed it on the date
  view before tabs existed.)*
- Empty state (no items yet): "O organizador ainda não montou o orçamento."

### 6.3 Budget tab — admin view (additionally)

- **Item CRUD** inline on the table: add row (name, value in R$, exemption
  select), edit, remove. No confirmation on remove — items are cheap to
  re-add and nothing downstream updates automatically.
- Live recompute of shares/summary on every change.
- **"Ativar cobrança"** (finalized events without active charging): opens the
  activation form from `pix-payments.md` §7.2 **prefilled** with the mapped
  values (§5) — still editable before confirming, and the per-participant
  preview works the same. Blocked with an explanation when `s_general = 0`
  (§5 edge case) or the event isn't finalized ("finalize a data primeiro").
- **After activation**, the **payment board** (`pix-payments.md` §7.2)
  renders in this tab, plus a **drift notice** when the live budget-derived
  values no longer match the active `event_charge_settings` (items edited,
  members joined/left, flags changed): "O orçamento mudou desde a ativação —
  desative e reative a cobrança para reprecificar." Consistent with
  `pix-payments.md` §6: no silent repricing, ever.

## 7. Resolved decisions

- **Exemption = the two existing flags**, modeled as a per-item enum
  (`none`/`alcohol`/`meat`), not a new tagging system. *(2026-07-08)*
- **Shares round up** (ceiling, in cents) per group, so the sum collected is
  never below the item costs; leftover cents stay with the admin.
  *(2026-07-08)*
- **The budget is live; charges are snapshots.** Budget math recomputes on
  every read from current members/flags; money amounts only freeze when
  charging is activated, and drift is surfaced but never auto-applied.
  *(2026-07-08)*
- **Payment UI relocates to the Budget tab** (participant card and admin
  board) — the money story lives in one place. The Dates tab keeps only
  voting concerns. *(2026-07-08, amends `pix-payments.md` §7)*

## 8. Future work

- Item quantities / unit prices ("picanha · 6 kg × R$ 55").
- Reimbursement tracking: a participant bought the charcoal — offset their
  share instead of the admin fronting everything.
- Custom exemption groups beyond alcohol/meat.
- Copy budget from a past event (pairs with the recurring-events series in
  `spec.md` §9).
