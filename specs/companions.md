# Companions ("Acompanhantes") — Specification

**Status:** Draft v1
**Last updated:** 2026-08-07
**Amends:**
- [`event-budget.md`](./event-budget.md) §5 — the split groups are no longer
  "approved participants" but **billable units** (participants **+** their
  companions); §6.2 — the "your share" card gains the companion list next to
  the flags editor.
- [`pix-payments.md`](./pix-payments.md) §4 — a participant's charge amount is
  the sum over their own unit and each of their companions; §6 — removal and
  post-activation edits compose with companions.
- [`spec.md`](./spec.md) §5.3 — removing a participant also deletes their
  companions.

## 1. Overview

Not everyone at a churrasco has an account. A participant brings a partner, a
friend, a cousin — they eat and drink like anyone else, and today the split
silently ignores them: the group under-collects, and the participant who
brought them pays a single share.

A **companion** is a nameless-to-the-system guest attached to one participant
("the **host**"). It has a **name and the two consumption flags, nothing
else** — no account, no login, no votes, no charge of its own. It counts as a
full unit in the budget split, and its cost is **added to its host's amount**:
one Pix charge per participant, covering the host and everyone they brought.

Companions are managed on the same screen where a participant already
self-declares "não bebo álcool" / "não como carne" — the Budget tab's "your
share" card ([`event-budget.md`](./event-budget.md) §6.2).

## 2. Goals & non-goals

### Goals
- A participant adds/edits/removes their own companions (name + two flags) on
  the Budget tab, in the same editing window as their own flags.
- Companions count as full participants in the budget split — headcount,
  drinkers, and meat-eaters groups all include them.
- The host's Pix charge is **their own share plus every companion's share**,
  as one amount, with a per-person breakdown visible.
- Admins can manage anyone's companions, including after charging is
  activated (which regenerates that host's unpaid charge).

### Non-goals (this version)
- Companions **voting** on dates or appearing on the Dates tab — they have no
  availability and never affect the ranking.
- A **separate charge** or payment status per companion. One charge per host,
  paid in full or not at all.
- Turning a companion into a real participant, or **transferring** a companion
  to another host — remove and re-add.
- Companion-only budget items ("a garrafa que a Ana trouxe") or exemption
  groups beyond the existing two flags.
- Contact details, age, plus-one invitations by email — a name is the whole
  identity.
- A per-event cap on companions set by the admin (there is a fixed per-host
  cap, §4).

## 3. Roles & permissions

| Role | Can do |
|------|--------|
| **Admin** | Add/edit/remove companions for **any** participant, at any event status, **including after charging is activated** — which cancels and regenerates that host's unpaid charge (§6). Everything a participant can. |
| **Participant** (approved member) | Add/edit/remove **their own** companions while the event has **no active charge** — the same window in which they may edit their own flags ([`pix-payments.md`](./pix-payments.md) §4). Sees everyone's companions read-only in the split. |
| **Non-member** | Nothing — companions sit behind the same membership gate as the rest of the event page. |

A participant may never touch another participant's companions. All writes go
through server actions that re-check the Auth0 session and role (`spec.md` §6).

## 4. Data model

### `event_companions`
One row per guest brought by one participant to one event.

- `id` (uuid, pk)
- `event_id` (fk → events.id, on delete cascade)
- `host_user_id` (fk → users.id, on delete cascade) — the participant who
  brought them and who pays for them
- `name` (text, non-empty after trimming, ≤ 60 chars)
- `no_alcohol` (bool, default false)
- `no_meat` (bool, default false)
- `created_at`, `updated_at`
- Index on (`event_id`), and on (`event_id`, `host_user_id`)

Rows are ordered by `created_at`. No soft delete.

**Why keyed on `(event_id, host_user_id)` and not on `event_memberships.id`:**
the event's creator is *implicitly* approved and may have **no membership
row** until their first flag write materializes one (`spec.md` §4,
`lib/events.ts` `listParticipants`). Keying on the user keeps the creator able
to bring companions on day one. The cost is that deleting a membership does
not cascade here — companion deletion is explicit, exactly like
`availabilities` (§6).

**Constraints and limits**
- **Max 10 companions per (event, host)** — enforced in the server layer, not
  in SQL. It is a sanity bound against a fat-fingered loop, not a product
  rule; the error copy says so ("limite de 10 acompanhantes por pessoa").
- **Names are not unique.** Two guests called "João" are fine; the name is a
  label for humans reading the split, not a key.
- Names are stored trimmed; an empty or whitespace-only name is rejected.
- A companion whose host is not an approved participant of the event must not
  exist — the write path checks the host's membership, and the removal path
  (§6) deletes the rows.

## 5. Computation (amends `event-budget.md` §5)

The split's unit of account becomes the **billable unit**: one approved
participant, or one companion. Everything else in `event-budget.md` §5 —
per-group ceilings, the base − deductions mapping, the "leftover cents stay
with the admin" rule — is unchanged; only the population grows.

**Groups**

| Group | Members | Size |
|---|---|---|
| everyone | all approved participants **+ all their companions** | `N` |
| drinkers | units with `no_alcohol = false` | `Nd` |
| meat-eaters | units with `no_meat = false` | `Nm` |

The share formulas are untouched:

```
s_general = ceil( Σ amount(exemption = none)    / N  )
s_alcohol = Nd > 0 ? ceil( Σ amount(exemption = alcohol) / Nd ) : 0
s_meat    = Nm > 0 ? ceil( Σ amount(exemption = meat)    / Nm ) : 0
```

**Per-unit amount** (unchanged): `s_general + (drinks ? s_alcohol : 0) +
(eats meat ? s_meat : 0)`.

**Per-participant amount** (new — what a host actually owes):

```
owed(host) = amount(host's own flags)
           + Σ amount(companion's flags)  for each companion of that host
```

Implementation note: `computeShares(items, flags[])` in `lib/budget.ts` is
already a pure function over a flat list of flag pairs — companions enter by
appending their flags to that list, and `amountFor` stays per-unit. The
summation above is the only new arithmetic.

**Edge cases**
- The `unsplitAlcohol` / `unsplitMeat` warnings (`event-budget.md` §5) now
  consider companions: a host who doesn't drink but brings someone who does
  makes `Nd = 1`, and the warning correctly disappears.
- A host who declares both flags but brings a companion with neither still
  owes a positive amount; the `s_general > 0` activation requirement
  (`event-budget.md` §5) is unchanged and still keyed on the *unit* minimum.
- Companions of a **pending** or **rejected** member never exist (§4), so
  they cannot leak into `N`.

## 6. Lifecycle & rules

**Editing window.** A participant may add/edit/remove their own companions
while the event has **no active charge**, at any event status — the same rule
and the same reason as the consumption flags ([`pix-payments.md`](./pix-payments.md)
§4): the split is live until money is quoted. Once
`event_charge_settings` exists, the participant's companion list renders
**read-only** with the same "fale com o organizador" note the flags editor
already shows.

**Admin edits after activation.** An admin may still add, rename, re-flag, or
remove a companion. Doing so **cancels and regenerates that host's unpaid
charge** at the current settings and the new unit count — identical to the
existing "admin edits a participant's flags" path
([`pix-payments.md`](./pix-payments.md) §4). A **paid** charge is never
regenerated: the app records the new companion, the amount owed no longer
matches what was paid, and the admin settles the difference out-of-band. The
confirmation dialog says exactly this.

**Charge amount** (amends [`pix-payments.md`](./pix-payments.md) §4). With
`event_charge_settings` active:

```
unit(flags) = base_price
            - (no_alcohol ? no_alcohol_deduction : 0)
            - (no_meat    ? no_meat_deduction    : 0)

amount(host) = unit(host flags) + Σ unit(companion flags)
```

`chargeAmountFor` in `lib/charges.ts` grows a companion-flags argument; every
caller (activation, `ensureChargeForUser` on post-activation approval,
regeneration) passes the host's current companions. The schema's
`base − both deductions > 0` check already guarantees every unit is positive,
so a multi-unit amount is positive too — **no schema change** to
`event_charge_settings`, and the one-live-charge-per-(event, user) index is
untouched because companions never get their own charge.

**Activation.** Charges are still created **one per approved participant**,
now priced over their units. A participant with companions gets one charge
for the whole group.

**Post-activation approvals** (`pix-payments.md` §6): a member approved after
activation has no companions yet, so nothing changes; if the admin then adds
companions for them, the regeneration path above applies.

**Participant removal** (amends `spec.md` §5.3). Removing a participant
deletes their `event_companions` rows in the same server operation that
deletes their votes and membership — ordered votes → companions → membership,
so a mid-way failure never strands rows pointing at a live membership. The
removal confirmation states that the participant's companions go with them.
The unpaid-charge cancellation is unchanged; a **paid** charge is still kept,
companions and all, so the collected total stays honest.

**Deactivating charging** does not touch companions — only charges. The split
keeps computing over units, and reactivation re-prices from the current unit
count.

**Drift.** Adding or removing a companion changes `N`, `Nd`, `Nm` and
therefore the budget-derived prices, so the Budget tab's existing drift notice
(`event-budget.md` §6.3) fires exactly as it does for a member joining. As
always: **surfaced, never auto-applied** — repricing is deactivate +
reactivate.

## 7. Screens

All of this lives in the **Budget tab**; the Dates tab and the main event list
are untouched.

### 7.1 "Your share" card — participant view (amends `event-budget.md` §6.2)

The card already holds the viewer's amount and their flags editor. It grows a
**companions section** directly below the flags:

- One row per companion: the **name** (inline-editable text), the two
  switches ("não bebe álcool" / "não come carne"), the companion's own
  computed amount, and a **remove** action.
- An **"Adicionar acompanhante"** row: a name field and an add button; the
  companion starts with both flags off (drinks and eats meat — the common
  case, and the safe default since it never under-collects).
- Removal is **inline, no confirmation dialog**, while charging is inactive —
  nothing downstream exists yet and a mis-click is one re-add away
  (consistent with budget-item removal, `event-budget.md` §6.3). Under active
  charging, where only an admin can do it, the confirmation from §6 applies.
- Every edit recomputes the whole tab live: the shares change for *everyone*,
  since `N` changed.

The card's headline amount becomes the host's **total**, with a per-person
breakdown when there is at least one companion:

```
Sua parte + 2 acompanhantes            R$ 135
  Você (não bebe)                      R$ 45
  Ana                                  R$ 60
  Beto (não come carne)                R$ 30
```

With no companions the card renders exactly as it does today — the existing
"R$ 60 − R$ 15 (não bebe) = R$ 45" breakdown line is kept for the viewer's own
unit.

### 7.2 Cost split card

The group-size line counts units and shows the composition, so nobody has to
guess why `N` grew:

> "12 pessoas (9 participantes + 3 acompanhantes) · 10 bebem · 11 comem carne"

The per-item "who splits it" group sizes count units too. The per-profile
amount matrix (full / no alcohol / no meat / both) is **per unit** and needs no
change — it already answers "what does one more person cost".

### 7.3 Activation form (admin)

The per-participant preview lists hosts with their companion count and the
combined amount, expandable to the per-unit lines:

> "Ana (+2)  R$ 135"

The confirmation dialog keeps counting **charges** (one per participant), and
adds the unit count: "3 cobranças serão criadas para 5 pessoas."

### 7.4 Payment board (admin)

Each row shows the host, their companions' names inline (with flag markers),
and the combined amount — the amount column stays the charge's
`amount_cents`, so paid/outstanding/refunded totals need no change. Row
actions are unchanged; "edit flags" grows the companion editor described in
§7.1, with the regeneration warning from §6.

### 7.5 Payment card (participant, charging active)

The breakdown under the amount lists the units the charge covers ("Você + Ana
+ Beto"), so a host paying R$ 135 sees why. The companion list itself renders
read-only here.

## 8. Internationalization

New copy goes in the existing **`budget`** namespace, added to all four
locales (`pt-BR`, `en`, `bs`, `zh-CN`) per [`i18n.md`](./i18n.md). Count-bearing
strings ("N acompanhantes", "9 participantes + 3 acompanhantes") use i18next
plurals. **Companion names are user data and are never translated**; amounts
keep using `formatBRL` (BRL formatting never localizes, `i18n.md`).

## 9. Resolved decisions

- **A companion is name + two flags, nothing else** *(2026-08-07)*. No email,
  no account, no votes. Anything more and it should have been a real
  participant.
- **Companions count as full units in the split** *(2026-08-07)*: they eat and
  drink like anyone else, so `N`, `Nd`, `Nm` include them. Fractional
  "half-shares" for kids were considered and rejected — it multiplies the
  pricing model for a case the group can settle socially.
- **The host pays for their companions in a single charge** *(2026-08-07)*.
  Per-companion charges would need a payer identity we deliberately don't
  collect ([`pix-payments.md`](./pix-payments.md) §2: no CPF), and the host is
  who the group holds responsible anyway.
- **Same editing window as the flags** *(2026-08-07)*: participants edit until
  charging is activated, admins always — with regeneration of unpaid charges.
  One rule for everything that moves the amount owed.
- **Keyed on `(event_id, host_user_id)`, not on the membership row**
  *(2026-08-07)*, so the creator — who may have no membership row yet — can
  bring companions. Deletion is explicit, like `availabilities`.
- **New companions default to both flags off** *(2026-08-07)* — the majority
  case, and the default that never under-collects.
- **Cap of 10 per host, server-side** *(2026-08-07)*. A guard rail, not a
  product rule, so it stays out of the schema.

## 10. Open questions

None. The two that came up while writing — half-shares for children, and
per-companion charges — are resolved above (§9) and listed as future work
below.

## 11. Future work

- **Fractional units** (a child counts as 0.5) — needs the share formulas to
  stop being integer-per-head and the rounding rule to be restated.
- **Promoting a companion to a participant** when the guest later creates an
  account: transfer the flags, keep the split stable, split the host's charge.
- **Companion-aware reminders** — depends on notifications, itself future work
  in `spec.md` §9.
- **Copying companions from a past event**, alongside copying its budget
  (`event-budget.md` §8) and the recurring-series work in `spec.md` §9.
