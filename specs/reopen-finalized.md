# Reopening Finalized Events — Specification

**Status:** Draft v1
**Last updated:** 2026-10-03
**Amends:**
- [`spec.md`](./spec.md) §5.2 — the admin controls gain a reopen path for
  `finalized` events, and "reopening needs no confirmation" no longer holds for
  all cases; §8 — the "Re-opening" resolved decision is revised (a `finalized`
  event *can* be reopened, under the conditions in [§4](#4-eligibility)).
- [`pix-payments.md`](./pix-payments.md) §6 — the event lifecycle gains a
  `finalized → open` transition, gated on charge state; the "only finalized
  events" rule for charging acquires a converse.
- [`shadcn-refactor.md`](./shadcn-refactor.md) §5.3 — the finalize dialog's
  prescribed copy ("the event cannot be reopened. This cannot be undone") is no
  longer true and is rewritten ([§6](#6-screens)).

## 1. Overview

Finalizing an event is one-way today: `reopenVoting` only accepts a `closed`
event, and the button only renders for one (`app/events/[id]/dates-tab.tsx`).
An admin who finalizes the wrong day — or whose group has to move the date
after the fact — has no path back inside the app. The only recourse is a manual
`update events set status = 'open'` in the SQL editor, which silently leaves
`finalized_date` and any Pix charges behind.

**The rule was never justified.** `spec.md` §5.2 asserts "finalizing is
one-way in v1" with no rationale, and §8 records it under resolved decisions
the same way. The archaeology:

- In v1 (`c9b456c`), **both** closing and finalizing were irreversible. On
  2026-07-04 closing became reversible (§8: *"closing was originally
  one-way"*); finalizing simply stayed behind. It was never argued for — it is
  the unrevisited half of a retired rule.
- The only rationale ever written down was derivative. `9f090d2` forbade
  participant removal on finalized events because *"a finalized event's record
  is **frozen**, consistent with one-way finalization"*.
- That premise was then **explicitly retracted**. `8b2919d` (2026-07-08) made
  removal legal on any status: *"people can change their mind about attending
  after the date is set."* The frozen-record idea died there; the one-way
  finalize outlived the only argument for it.

What *has* appeared since is a real reason to be careful, which no spec ever
connected to this rule: finalizing is the **gate for collecting money**
(`pix-payments.md` §6, "charging can only be activated on a `finalized`
event"). Reopening an event with live Pix charges would leave participants
holding copia-e-cola codes for a date that no longer exists.

So the rule is replaced by its actual content: **reopening is allowed unless
money is in flight or already collected.** Where the old rule said "never",
this one says "not while there is a charge to honor" — and tells the admin how
to clear the blocker.

## 2. Goals & non-goals

### Goals
- An admin can send a `finalized` event back to `open`, from the event page,
  when the event has **no charge obligations** ([§4](#4-eligibility)).
- The transition discards the chosen date and restores voting, leaving votes,
  memberships, flags, companions and budget items untouched
  ([§5](#5-what-the-transition-does)).
- When an event is finalized but **not** eligible, the admin sees *why*, not a
  missing button ([§6](#6-screens)).
- The eligibility rule is enforced server-side and fails **loudly** — the
  current action's zero-row no-op is fixed ([§7](#7-server-action)).

### Non-goals (this version)
- **Audit trail.** The discarded `finalized_date` is not archived anywhere; a
  reopened event cannot tell you which date it used to hold. v1 has no event
  history table and this spec does not add one (see
  [§11](#11-future-work)).
- **Automatic refunds.** Unchanged from `pix-payments.md` §2 — clearing a
  `paid` charge still means the admin sends the Pix back from their bank app
  and marks the charge `refunded`. This spec only *reads* that state.
- **Re-finalizing for the admin.** Reopening does not pre-select the old day or
  re-finalize anything; the admin finalizes again normally, which already works
  on an `open` event (`dates-tab.tsx` hides "pick this date" only on
  `finalized`).
- **Changing who may reopen.** It stays the global `users.is_admin` flag, with
  all of its all-or-nothing reach (`spec.md` §3). Per-event roles are a
  separate question.
- **The `closed → open` path.** Unchanged, including its lack of a
  confirmation.
- **Notifying participants** that the date was dropped. No in-app
  notifications in v1 (`spec.md` §9); the admin messages the group
  out-of-band, as with every other event change.

## 3. Roles & permissions

| Role | Can do |
|------|--------|
| **Admin** | Reopen a `finalized` event that is eligible ([§4](#4-eligibility)); see the blocking reason when it is not. |
| **Participant** | Nothing new. After a reopen they simply find voting open again and may mark availability (`toggleAvailability` already requires `status = 'open'`). |

Enforced in the server layer like every other write (`spec.md` §6).

## 4. Eligibility

A `finalized` event may be reopened **iff both** hold:

1. **No active charging** — no `event_charge_settings` row for the event.
   Existence of that row *is* charging being active (`pix-payments.md` §4).
2. **No charge left to honor** — no `pix_charges` row for the event with
   status in (`pending`, `paid`, `expired`).

A `closed` event stays reopenable with no conditions — it never had charging to
begin with (charging requires `finalized`).

### Why condition 2 is not redundant

Deactivating charging deletes the settings row and cancels `pending`/`expired`
charges, but **`paid` charges are kept** — "money already moved; the admin
handles refunds out-of-band" (`pix-payments.md` §6, *Deactivation*). So
condition 1 alone would happily reopen an event where everyone already paid and
nobody was refunded: the collected total would stand against a date the app no
longer claims.

`pending` and `expired` are in the list defensively. Deactivation should have
canceled them, so a row in either state alongside no settings row means an
invariant already broke — that is a reason to refuse, not to proceed.

### What does *not* block

- **`canceled`** — no money ever moved.
- **`refunded`** — the money went back. This matches how `pix-payments.md` §6
  already reads `refunded` elsewhere: a re-approved participant whose charge
  was refunded *"owe[s] again"*, i.e. the obligation is settled and the slate
  is clean.

### How an admin clears a blocker

No new escape hatch — the existing actions compose into a path:

1. **Deactivate charging** (`deactivateCharging`) — kills the settings row and
   cancels every unpaid charge.
2. For each remaining `paid` charge: refund out-of-band, then **mark as
   refunded** (`markChargeRefunded`), which is already admin-only and
   confirmation-gated.
3. Reopen becomes available.

This is deliberately laborious. Reopening an event people have paid for should
cost the admin the same steps as actually making them whole.

### The orphan-charge dead end

One case needs a UI fix to be recoverable at all. If a `pending`/`expired`
charge exists with **no** settings row (the broken invariant condition 2 guards
against), the admin has the right actions but **no button**: both the payment
board and the "Desativar cobrança" control render only when `chargeSettings` is
non-null (`app/events/[id]/budget-tab.tsx`). The event would be permanently
unreopenable through the UI.

The server side already works — `deactivateCharging` cancels by `event_id`
without consulting the settings row, and deleting an absent row is a harmless
no-op, so one call clears exactly this state. So the rule is:

> The Budget tab renders the **"Desativar cobrança"** control whenever the
> event has any `pending`/`expired` charge, even with no settings row — not
> only when charging is active.

Cheaper and safer than a bespoke cleanup action, and it makes the existing
recovery path reachable.

### Database hardening

The eligibility check and the status write are not atomic, and the dangerous
interleaving is real: reopen reads "no charges" → another admin activates
charging → reopen flips the status, leaving an `open` event with live Pix
codes. Rather than rely on timing, enforce the invariant where it cannot be
raced — a trigger on `event_charge_settings` rejecting an insert when the event
is not `finalized`, in the style of the existing
`availabilities_within_window` trigger (`supabase/schema.sql`):

> charging settings may only exist for an event whose `status = 'finalized'`

With that in place, the losing side of the race fails at the database instead
of producing a broken state. [§7](#7-server-action) still re-checks after the
write as a belt-and-braces measure.

## 5. What the transition does

On a successful reopen of a `finalized` event:

| Field / table | Effect |
|---|---|
| `events.status` | `finalized` → `open` |
| `events.finalized_date` | → `null` (`spec.md` §4: set only when status is `finalized`) |
| `events.updated_at` | bumped |
| `availabilities` | **untouched** — every vote survives; this is the point of reopening |
| `event_memberships` | untouched, including consumption flags |
| `event_companions` | untouched |
| `budget_items` | untouched (editable at any status per `event-budget.md` §3) |
| `pix_charges` | untouched — by [§4](#4-eligibility) only `canceled`/`refunded` history can exist |

Nulling `finalized_date` is required, not cosmetic: an `open` event carrying a
stale date would contradict the data model and surface a chosen-date badge on
an event that has none. The old value is **discarded** — see
[§2](#2-goals--non-goals) non-goals and [§11](#11-future-work).

**Consequences that follow from existing rules** (no new behavior needed):

- Participants regain the right to edit their own consumption flags — that
  right is gated on charging being inactive (`pix-payments.md` §4, *Editing
  window*), which [§4](#4-eligibility) already guarantees.
- The Budget tab's "Ativar cobrança" disappears and is replaced by the existing
  "finalize a data primeiro" message (`event-budget.md` §6), because the event
  is no longer `finalized`.
- Budget items and the computed split stay visible and editable; only charging
  is gated.

## 6. Screens

All of this lives in the **Dates tab** admin controls (`spec.md` §5.2), beside
the existing close/reopen/delete buttons.

### Finalized and eligible

A **"Reabrir votação"** button that **confirms** before firing, via the same
`ConfirmActionButton` used by close, finalize and delete
(`specs/shadcn-refactor.md` §5.3). The dialog states what is lost:

> **Reabrir votação?**
> A data escolhida para "{{title}}" será descartada e os participantes poderão
> alterar a disponibilidade novamente. Os votos são mantidos. Você precisará
> finalizar uma data outra vez.

This is an **intentional asymmetry** with the `closed → open` reopen, which
stays unconfirmed: that one restores a state nothing depended on, while this
one throws away the chosen date. It amends `spec.md` §5.2's blanket
"Reopening needs no confirmation."

### Finalized and *not* eligible

Render the button **disabled** with the blocking reason next to it, rather than
hiding it — the admin should learn the rule, not wonder whether the feature
exists. This follows the precedent of the activation form, which explains
"finalize a data primeiro" instead of vanishing (`event-budget.md` §6).

| Blocker | Message |
|---|---|
| Active charging | "Desative a cobrança para poder reabrir a votação." |
| Paid charges not refunded | "Há pagamentos recebidos que ainda não foram devolvidos." |
| Orphan `pending`/`expired` charge, no settings row | Same as active charging — the fix is the same call ([§4](#4-eligibility), *orphan-charge dead end*) |

When more than one applies, the active-charging message wins — it is the first
step of the path in [§4](#4-eligibility).

### The finalize dialog's copy becomes false

`event.finalize.description` currently reads *"A votação termina e o evento
**não pode ser reaberto**. Isso não pode ser desfeito."* — prescribed by
`shadcn-refactor.md` §5.3 when finalizing was one-way. Both sentences stop
being true, and this is the one place a user is told the old rule, so it must
be rewritten in all four locales. Suggested `pt-BR`:

> Finalizar {{date}} para "{{title}}"? A votação termina e os participantes não
> poderão mais alterar a disponibilidade. Você pode reabrir a votação depois,
> desde que ainda não tenha ativado a cobrança.

The dialog stays — finalizing still ends live voting, which is reason enough to
confirm (`spec.md` §5.2). Only the irreversibility claim goes.

### Unchanged

- `closed` → the existing unconfirmed reopen button.
- `open` → no reopen button.
- Non-admins see none of this.

## 7. Server action

`reopenVoting(eventId)` keeps its name and signature, and gains the finalized
path:

1. `requireAdmin()` — unchanged.
2. Load the event; 404-equivalent error if missing.
3. If `status = 'open'` → error (nothing to reopen).
4. If `status = 'finalized'` → evaluate [§4](#4-eligibility) against
   `event_charge_settings` and `pix_charges`; on failure throw the translated
   error naming the blocker.
5. Write `status = 'open'`, `finalized_date = null`, bumping `updated_at`,
   **conditional on the status still being what step 2 read** (keep the
   existing `.eq("status", …)` as a race guard).
6. **Fail loudly on a zero-row write.** Today the action ends at
   `.eq("status", "closed")` and ignores the row count, so an ineligible call
   returns no error and silently does nothing. The write must assert that a row
   matched and throw a translated error otherwise.
7. Re-read `event_charge_settings` after the write; if a row appeared, roll the
   status back and error. Redundant once the trigger in
   [§4](#4-eligibility) exists — kept because it costs one query and the
   trigger is a migration that may lag.
8. `revalidatePath` for the event page and the list — unchanged.

Step 6 fixes a latent bug independent of this feature: the current silent
no-op means any future caller of `reopenVoting` on a finalized event would
believe it succeeded.

## 8. Internationalization

New copy in the `event` namespace, in all four locales — `pt-BR`, `en`,
`zh-CN`, `bs` (`i18n.md` §1), with `pt-BR` as the source of truth and
fallback.

The flat `reopenVoting` key stays as the `closed` button's label. The finalized
variant needs a group, since it has a dialog:

- `reopenFinalized.label`, `.title`, `.description` (interpolates `title`),
  `.pending`
- `reopenFinalized.blockedCharging`, `.blockedPaid` — the [§6](#6-screens)
  disabled-state messages
- Server-action errors for step 4/6 failures, alongside the existing
  `errors.*` keys used by `tError`

**Revised** copy, all four locales: `event.finalize.description`, which still
promises the event "não pode ser reaberto" ([§6](#6-screens)). This is a
translation change to an existing key, not a new one — no key renaming, so
nothing else referencing it needs to move.

No money or date formatting is introduced, so `i18n.md` §5 (BRL never
localizes) does not come into play.

## 9. Resolved decisions

- **Reopening a finalized event is allowed, gated on charge state**
  *(2026-10-03)* — replaces `spec.md` §8's unconditional "a `finalized` event
  cannot [be reopened]". The old rule had no recorded rationale and the one
  argument ever written for it (the "frozen record", `9f090d2`) was retracted
  on 2026-07-08 by `8b2919d`. The genuine constraint is charge obligations, so
  that is what the rule now checks.
- **Both conditions, not just "charging inactive"** *(2026-10-03)* — because
  deactivation keeps `paid` charges, the settings row alone is not a proxy for
  "nobody is owed anything".
- **`refunded` does not block; `paid` does** *(2026-10-03)* — consistent with
  `pix-payments.md` §6 treating a refunded charge as a settled obligation.
- **No dedicated unblock action** *(2026-10-03)* — deactivate + mark refunded
  already express it, and routing the admin through them means the app never
  implies money came back when it did not. The orphan-charge case is fixed by
  *showing* the existing deactivate control in one more state
  ([§4](#4-eligibility)), not by adding an action.
- **Confirmation required here, not on `closed → open`** *(2026-10-03)* — this
  transition destroys the chosen date; the other restores a state nothing
  depended on.
- **`finalized_date` is nulled, not kept** *(2026-10-03)* — an `open` event
  with a chosen date contradicts the data model. Losing the old value is
  accepted in v1 for lack of any history table.
- **A past date window does not block reopening** *(2026-10-03)* — reopening an
  elapsed window is probably a mistake, but the app has no notion of a stale
  event anywhere else (nothing else checks a window against today), the 6-month
  cap keeps the case rare, and an admin fixing up an old event is a legitimate
  use. Left permitted; revisit if it bites.

## 10. Open questions

None at the moment — the past-window question was resolved on 2026-10-03 (see
[§9](#9-resolved-decisions)).

## 11. Future work

- **Event history / audit log** — would preserve discarded `finalized_date`
  values (and would also give the removal and charge-cancellation paths a
  record). The one real loss this spec accepts.
- **Participant notification on reopen** — depends on notifications, itself
  future work in `spec.md` §9. The group currently finds out because the admin
  tells them.
- **Per-event admin roles** — orthogonal, but relevant: reopening is a
  destructive event-level action currently available to every global admin on
  every event.
