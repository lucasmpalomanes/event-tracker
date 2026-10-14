# Participant Details on Hover — Specification

**Status:** Draft v1
**Last updated:** 2026-10-13
**Amends:**
- [`spec.md`](./spec.md) §5.2 — the admin participant list gains a hover/focus
  tooltip per participant.
- [`companions.md`](./companions.md) §7 — companion counts surface on the
  Dates tab too (admin only), not just in the Budget tab's split.

## 1. Overview

The admin's participant list on the Dates tab (`app/events/[id]/dates-tab.tsx`)
shows each participant as `name ?? email`, plus their vote count and the
clear-votes / remove actions. Two things an admin routinely needs are not
there:

- **Who this is, exactly.** Names are free text from Auth0 and collide
  ("Lucas", "Lucas M."); the email is the only stable identifier, and it is
  hidden as soon as the user has a name.
- **How many people they bring.** Companion counts live only in the Budget
  tab's split ([`companions.md`](./companions.md) §7.2). When deciding whether
  to remove a participant, the admin has to switch tabs to see that removing
  them also removes N companions (`companions.md` §6, cascade).

Both fit in a tooltip on the participant's name — no layout change to a list
that already wraps on mobile.

## 2. Goals & non-goals

### Goals
- Hovering (or keyboard-focusing) a participant's name in the admin list shows
  their **email** and their **companion count**.
- Works for every row, including the creator's.
- No new queries: both values are already loaded by the event page.

### Non-goals (this version)
- Listing companion **names** or flags in the tooltip — that is the Budget
  tab's job.
- Any participant-facing (non-admin) version. Emails stay admin-only.
- A tap-to-open affordance on touch devices (§7).
- Showing the same tooltip elsewhere (Budget split, payment board).

## 3. Roles & permissions

| Role | Sees |
|------|------|
| **Admin** | The tooltip on every row of the participant list. |
| **Participant / non-member** | Nothing new. The participant list itself is already admin-only (`{isAdmin && …}`), and the tooltip lives inside it. |

**Emails must not reach non-admin HTML.** `DatesTab` is a server component, so
the `Participant` objects (which carry `email`) are not serialized to the
client by themselves; only what is rendered is. The tooltip content must be
rendered **only inside the existing `isAdmin` branch** — never rendered and
hidden with CSS, never passed as a prop to a client component outside that
branch.

## 4. Data

No schema or query changes.

- **Email** — `Participant.email` from `listParticipants` (`lib/events.ts`),
  already joined from `users`.
- **Companion count** — `companionsOf(companions, p.userId).length`
  (`lib/companions.ts`). `page.tsx` already loads `companions` via
  `listEventCompanions` for the Budget tab; it is now also passed to
  `DatesTab` as a new `companions: Companion[]` prop.

The count is keyed on `host_user_id`, so the creator's companions are counted
even if they have no membership row (`companions.md` §9).

## 5. Behavior

- **Trigger:** the participant's display name (`name ?? email`, plus the
  "(creator)" suffix). Not the whole row — the row holds action buttons that
  have their own tooltips/dialogs.
- **Content**, two lines:
  1. the email, verbatim (user data, never translated or truncated by
     the app; the tooltip's `max-w-xs` wraps it);
  2. the companion count, pluralized: "Sem acompanhantes" / "1 acompanhante" /
     "3 acompanhantes".
- The email line is shown **even when the display name already is the email**
  (user without a name). Redundant but consistent; one rendering path.
- **Keyboard:** the trigger is focusable (Base UI `TooltipTrigger` rendered as
  a `<span tabIndex={0}>` or a non-submitting button styled as text), so the
  tooltip opens on focus and closes on blur/Escape.
- **Delay:** the app-wide `TooltipProvider` default (`app/layout.tsx`). No
  per-row override.
- Values are a snapshot of the server render, like the rest of the list; they
  refresh on the next navigation/revalidation (e.g. after `removeParticipant`).

## 6. Screens

Uses the existing shadcn/Base UI `Tooltip` (`components/ui/tooltip.tsx`), as
in `auto-approve-toggle.tsx`. Visual change to the list at rest: none — the
name may gain a dotted underline (`underline decoration-dotted
underline-offset-4`) to hint that it is hoverable.

```
Participants
  Ana Souza ┄┄┄┄┄┄     2 votes   [Clear votes] [Remove]
   ┌───────────────────────┐
   │ ana.souza@gmail.com   │
   │ 2 acompanhantes       │
   └──────────┬────────────┘
```

## 7. Touch devices

Base UI tooltips do not open on touch, so admins on a phone will not see this.
Accepted for v1: the companion count is still reachable on the Budget tab, and
the admin list is primarily a desktop tool. See §10.

## 8. Internationalization

New keys in the **`event`** namespace, all four locales (`pt-BR`, `en`, `bs`,
`zh-CN`) per [`i18n.md`](./i18n.md):

- `participantCompanions_zero` / `_one` / `_other` — "No companions" /
  "{{count}} companion" / "{{count}} companions" (and locale equivalents;
  `zh-CN` only needs `_other` + `_zero`, as usual for i18next).

The email is user data and is never localized.

## 9. Resolved decisions

- **Tooltip, not a new column** *(2026-10-13)*. The row already wraps actions
  into a column on mobile; an email column would break it for a value that is
  looked up occasionally.
- **Count only, not names** *(2026-10-13)*. The question the admin is
  answering is "how many people does this person bring"; names are on the
  Budget tab.
- **Reuse the already-loaded `companions`** *(2026-10-13)* rather than adding a
  count to `listParticipants` — one source of truth, zero extra round trips.

## 10. Open questions

- **Touch support.** If admins turn out to manage events from phones, swap the
  tooltip for a Popover (tap to open) — same content, same trigger.

## 11. Future work

- The same hover on the Budget tab's split rows and on the payment board.
