# Event Tracker — UI Refactor: shadcn/ui

**Status:** Draft v1
**Last updated:** 2026-07-05
**Depends on:** [`spec.md`](./spec.md) (product spec — this document changes no product behavior)

## 1. Overview

Refactor the app's hand-rolled Tailwind UI to [shadcn/ui](https://ui.shadcn.com)
components, initialized with a specific preset:

```sh
npx shadcn@latest init --preset b6HIN5bLE --template next
```

The preset is the **source of truth for theme and style** (base color, CSS
variable tokens, fonts, radii, component style). Whatever `components.json` and
`app/globals.css` the CLI generates from preset `b6HIN5bLE` is adopted as-is
and committed; this spec deliberately does not restate the preset's contents so
the two can't drift.

This is a **behavior-preserving refactor**: every screen, state, and flow in
[`spec.md` §5](./spec.md#5-screens) must work exactly as before. Only the
presentation layer changes — with **one deliberate exception**: two admin
actions that today fire immediately, **"Pick" (finalize a date)** and
**"Close voting"**, are reclassified as destructive and gain a confirmation
dialog (see [§5.3](#53-date-page-appeventsidpagetsx)). That decision is
recorded in the product spec ([`spec.md` §5.2](./spec.md#52-date-page)).

## 2. Goals & non-goals

### Goals
- All interactive/styled UI is built from shadcn/ui primitives styled by the
  preset's design tokens — no more ad-hoc `border-black/[.08] dark:border-white/[.145]`
  utility soup repeated across files.
- Replace `window.confirm()` with a proper `AlertDialog` for every destructive
  action (participant/vote removal, event deletion, auto-approve warning, picking the final date, closing the event).
- Consistent dark mode driven by the preset's CSS variables instead of
  per-element `dark:` overrides.
- Shared components live in `components/` (per `components.json` aliases);
  route files keep only page composition and data flow.

### Non-goals
- No redesign: layout, information architecture, and copy stay as they are.
  Visual changes are limited to what adopting the preset's tokens implies.
- No new features, no server/action/data-layer changes (`app/actions.ts`,
  `lib/*`, `supabase/*` are untouched except comment path updates). The new
  finalize/close confirmations are client-side only — the server actions
  (`finalizeEvent`, `closeVoting`) don't change.
- No theme toggle UI. Dark mode remains driven by `prefers-color-scheme`
  (see [§6 Dark mode](#6-dark-mode)).
- Not replacing the custom voting calendar with shadcn's `Calendar`
  (see [§5.4](#54-voting-calendar-stays-custom)).

## 3. Constraints

- ⚠️ **Non-standard Next.js 16** (see `AGENTS.md`): before wiring anything the
  CLI generates, verify it against `node_modules/next/dist/docs/`. In
  particular this project uses `proxy.ts` (Next 16's renamed middleware); if
  the shadcn template assumes older conventions (e.g. `middleware.ts`, other
  file layout), the project's conventions win.
- **`--template next` caveat:** the `--template` flag is meant for scaffolding.
  The project already exists — run the command from the repo root and let init
  configure the existing app. If the CLI instead tries to scaffold a fresh
  project, abort and re-run `npx shadcn@latest init --preset b6HIN5bLE` without
  the template flag. The preset, not the template, is what matters.
- **Tailwind CSS 4**: `app/globals.css` uses `@import "tailwindcss"` +
  `@theme inline`. The init rewrites this file with the preset's tokens; the
  existing Geist font variables (`--font-geist-sans`, `--font-geist-mono`,
  wired in `app/layout.tsx`) must survive the rewrite unless the preset
  supplies its own fonts.
- React 19 Server Components: shadcn primitives that render Radix portals or
  hold state are client components. Keep pages as server components and push
  `"use client"` down to leaf components, as the codebase already does.

## 4. Setup (phase 0)

1. Run the init command above; review the diff it produces
   (`components.json`, `app/globals.css`, `lib/utils.ts` with `cn()`, new
   dependencies — expect `radix-ui`/`@radix-ui/*`, `clsx`, `tailwind-merge`,
   `class-variance-authority`, `lucide-react`, `tw-animate-css` or similar).
2. Restore the Geist font hookup in `globals.css` if the rewrite dropped it.
3. Add components on demand via `npx shadcn@latest add <name>`; they land under
   the alias configured by the preset (expected: `components/ui/`).
4. Verify `npm run build` and `npm run lint` pass before any refactor commits.

Components needed (add in phase 0 or as each screen needs them):
`button`, `badge`, `card`, `input`, `textarea`, `label`, `checkbox`, `switch`,
`alert-dialog`, `collapsible`, `tooltip`, `separator`.

## 5. Refactor plan, screen by screen

### 5.1 Cross-cutting replacements

| Current pattern | Occurrences | Replacement |
|---|---|---|
| Pill buttons (`rounded-full bg-black …` / bordered variants) | all screens | `Button` (`default`, `outline`, `ghost`, `destructive` variants; `size="sm"`/`"xs"`-equivalent for inline admin actions) |
| Status pills ("Voting open", "N pending requests") | list + date page | `Badge` (`outline` for status, a warning-toned variant for pending counts) |
| White bordered boxes (`rounded-xl border … bg-white dark:bg-zinc-950`) | event rows, ranking items, participants panel, pending-requests panel | `Card` (with `CardHeader`/`CardContent` where the box has a heading) |
| Form fields (`inputClass` in `app/events/new/page.tsx`, edit-details form) | new-event + date page | `Input`, `Textarea`, `Label`, `Checkbox` |
| `window.confirm()` | `delete-event-button.tsx`, `admin-remove-buttons.tsx` (×3), `auto-approve-toggle.tsx` | `AlertDialog` with the same warning copy, destructive-styled confirm button |
| Unconfirmed destructive form submits | "Pick" (finalize) and "Close voting" on the date page | **new** `AlertDialog` confirmations — see [§5.3](#53-date-page-appeventsidpagetsx); the only intentional behavior change in this refactor |
| `title=` attribute hints (holiday names, auto-approve explainer, remove-vote) | date page | `Tooltip` (keep `title`/`aria-label` as fallback where the trigger is disabled) |
| Raw `text-zinc-*` / `text-black dark:text-zinc-50` colors | everywhere | semantic tokens: `text-foreground`, `text-muted-foreground`, `bg-background`, `bg-card`, `border-border`, `bg-destructive`, etc. |

### 5.2 Main page (`app/page.tsx`)

- Logged-out hero: `Button` (as link) for "Log in"; typography via tokens.
- Header: "Log out" becomes an `outline` `Button` link; user name stays plain
  `text-muted-foreground`.
- Event rows (`EventRow`): `Card` per row. Status → `Badge variant="outline"`;
  admin pending count → warning `Badge`. Actions per membership state keep
  exact semantics from spec §5.1: "Join"/"Request to enter" → `Button`
  (still a `<form action={requestAccess…}>` submit), "Awaiting approval" →
  muted text, "Request again" → `Button variant="outline"`.

### 5.3 Date page (`app/events/[id]/page.tsx`)

- Title row: status → `Badge`; back link stays a plain link.
- Admin "Edit details" `<details>/<summary>` → `Collapsible` with the same
  form inside (`Label` + `Textarea` + `Input` + `Button`).
- Pending access requests panel: `Card` with warning-toned styling; per-row
  Approve (`Button size="sm"`) / Reject (`Button size="sm" variant="outline"`).
- Admin control strip: **Close voting** → small `outline` `Button` opening an
  `AlertDialog` (**new** — today it submits immediately). Suggested copy:
  "Close voting for \"{title}\"? Participants can no longer change their
  availability. You can reopen voting later." **Reopen voting** stays an
  unconfirmed form submit — it is the reversible, non-destructive direction.
  Delete event → `Button variant="destructive"` opening an `AlertDialog`
  (replaces `window.confirm` in `delete-event-button.tsx`).
- Auto-approve toggle (`auto-approve-toggle.tsx`): becomes `Switch` + `Label`.
  When switching **on** with pending requests, an `AlertDialog` carries the
  current warning copy ("will also approve the N pending requests…") before
  calling `setAutoApprove` — the confirm-before-approve rule of spec
  §4/[auto-approval] is unchanged. Switching off, or on with zero pending,
  fires directly (same as today).
- Ranking panel: each day → `Card` row (or a single `Card` with `Separator`s);
  holiday annotation keeps its accent color via a token-based class; "Pick" →
  small `outline` `Button` opening an `AlertDialog` (**new** — today it
  submits immediately). Finalizing is **one-way** (spec §5.2), so the copy
  must say so; suggested: "Finalize {date} for \"{title}\"? Voting ends and
  the event cannot be reopened. This cannot be undone." Per-voter remove "×"
  → `Button variant="ghost" size="icon"` wrapped in the shared confirm
  `AlertDialog`.
- Participants panel: `Card`; "Clear votes" → `outline` `Button`, "Remove" →
  `destructive`-outline `Button`, both with `AlertDialog` confirmation
  (replaces `admin-remove-buttons.tsx`'s three `window.confirm`s; copy is
  preserved verbatim — it encodes spec §5.3 rules like "their votes go too").
- Legend chips: small colored squares keep custom classes but read colors from
  the same tokens the calendar uses.

### 5.4 Voting calendar stays custom

shadcn's `Calendar` (react-day-picker) is a date **picker**; the voting grid
(`calendar.tsx`) is a multi-month, per-day toggle board with vote counts,
optimistic updates, and holiday/weekend/mine precedence (spec §5.2). Wrapping
it into a picker abstraction would fight the component. Instead:

- Keep `Calendar` as a custom client component, moved to
  `components/voting-calendar.tsx`.
- Day cells restyle with preset tokens + `cn()` from `lib/utils.ts` instead of
  the current string-array join.
- Holiday/weekend/selected tones become **named CSS variables or Tailwind
  utilities defined once in `globals.css`** (e.g. `--holiday`, `--weekend`,
  chosen to harmonize with the preset palette), so the calendar, ranking
  annotations, and legend share them. Precedence holiday > weekend > weekday
  and the "mine" ring are unchanged.
- `useOptimistic` toggle logic is untouched.

### 5.5 New-event page (`app/events/new/page.tsx`)

- Form rebuilt from `Label` + `Input` / `Textarea` / `Checkbox` (auto-approve,
  keeping its two-line explainer as muted text) + `Button` submit. Same
  fields, same server action (`createEvent`), same 6-month-cap helper text.

### 5.6 File organization

- Generated primitives: `components/ui/*` (CLI-managed; don't hand-edit).
- App-level shared components: `components/` — `voting-calendar.tsx`,
  `confirm-action-button.tsx` (a reusable "button + AlertDialog + pending
  state + server-action call" wrapper that replaces `delete-event-button.tsx`,
  `admin-remove-buttons.tsx`, the confirm path of the auto-approve switch,
  and the new finalize/close-voting confirmations — note these last two are
  currently plain `<form action=…>` submits in a server component, so
  adopting the wrapper also makes them client-triggered action calls), and
  anything else used by more than one route.
- Route-private composition (e.g. `EventRow`) may stay next to its page.

## 6. Dark mode

Today dark mode is pure `prefers-color-scheme` via `dark:` utilities. shadcn
presets typically define dark tokens under a `.dark` class. Decision: **keep
OS-driven dark mode, no toggle.** Implement by mapping the preset's `.dark`
token block to the media query (Tailwind 4 `@custom-variant` /
`@media (prefers-color-scheme: dark)` wrapper in `globals.css`) so components
pick up dark values automatically. A user-facing theme toggle is future work.

## 7. Acceptance criteria

- `npm run build` and `npm run lint` pass.
- No `window.confirm` remains; every destructive action shows an `AlertDialog`
  before firing its server action — with the previous warning copy for the
  actions that already confirmed, and the new copy from
  [§5.3](#53-date-page-appeventsidpagetsx) for "Pick" (finalize) and
  "Close voting". Cancelling any dialog fires nothing.
- No raw palette classes (`zinc-*`, `bg-black`, hex values) in app components
  except the calendar/legend accent utilities defined in `globals.css`;
  everything else uses preset tokens.
- Manual pass over spec §5 flows in light **and** dark mode: logged-out hero,
  event list in all four membership states, request/join, pending-request
  approve/reject, availability toggling with optimistic update, ranking +
  finalize (confirm and cancel the new dialog), close voting (confirm and
  cancel) + reopen (no dialog), auto-approve on/off (with and without
  pending requests),
  participant removal / clear votes / single-vote removal, event
  create/edit/delete, closed & finalized read-only states.
- Server actions, `lib/`, and `supabase/` diffs are empty (comment-only
  changes excepted).

## 8. Open questions

- Exact contents of preset `b6HIN5bLE` (base color, fonts, radius) are only
  knowable by running init — phase 0 reviews and commits that output. If the
  preset ships its own font stack, decide then whether it replaces Geist
  (default: preset wins, since it was chosen deliberately).
- Whether the CLI version at implementation time supports `--preset` together
  with an existing project cleanly; fallback documented in [§3](#3-constraints).

## 9. Future work

- Theme toggle (light/dark/system) once a `.dark`-class strategy is wanted.
- Toasts (`sonner`) for action feedback (approve/reject/remove currently give
  no confirmation beyond the UI updating).
- `Table` for the participants panel if it grows columns (joined date, etc.).
