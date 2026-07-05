# Event Tracker — Specification

**Status:** Draft v1
**Last updated:** 2026-07-04

## 1. Overview

Event Tracker helps a group settle on the best date for an event. An admin
creates an event with a candidate date window; logged-in participants mark the
days they are available on a calendar, and the app surfaces a ranking of the
most-available days so the admin can pick a final date.

The product is scoped to **single, one-off events** for v1. The name "future
iterations" refers to a planned later capability (recurring event series) that
is intentionally **out of scope** for this version — see [§9 Future work](#9-future-work).

## 2. Goals & non-goals

### Goals (v1)
- Admins can create and manage events.
- Logged-in users can browse events and open an event's date page.
- Participants mark their availability across a candidate date window on a calendar.
- A live ranking shows the most-voted (most-available) days.
- The calendar visually distinguishes weekends and Brazilian national holidays.

### Non-goals (v1)
- Recurring events / linked event series.
- Notifications, reminders, or email invites.
- Comments, chat, or attachments on events.
- Public (non-authenticated) voting.
- Time-of-day / hourly availability (day-granularity only).
- Payments, ticketing, or RSVP headcount limits.

## 3. Roles & permissions

| Role | Can do |
|------|--------|
| **Admin** | Create, edit, and delete events. **Approve/reject who may enter an event**, or enable **auto-approval** per event. Open/close voting. Finalize the chosen date. Everything a participant can do. |
| **Participant** (any logged-in user) | Browse the full event list, request to enter an event, and — once approved — mark/update their own availability and view the ranking. |
| **Anonymous visitor** | See the main page (event list is gated or teased) and the login entry point only. |

Admin status is a flag on the user record (`users.is_admin`). Event creation is
**admin-only**; regular users cannot create events in v1.

**Visibility vs. access.** Every logged-in user can *see* all events in the
list. *Entering* an event (viewing its date page, marking availability) requires
an **approved membership** — the user requests to enter and an admin approves,
unless the event has **auto-approve** enabled, in which case the request is
approved on the spot. See [`event_memberships`](#event_memberships),
[auto-approval](#auto-approving-new-members) and [§5](#5-screens).

## 4. Key concepts / data model

Storage is **Supabase (Postgres)**. Identity is **Auth0** (see [§6](#6-authentication--identity)).

### `users`
Mirror of Auth0 identities, synced on first login.
- `id` (uuid, pk)
- `auth0_sub` (text, unique) — Auth0 `sub` claim, the source-of-truth identifier
- `email` (text)
- `name` (text)
- `is_admin` (bool, default false)
- `created_at`, `updated_at`

### `events`
- `id` (uuid, pk)
- `created_by` (fk → users.id) — the admin who created it
- `title` (text)
- `description` (text, nullable)
- `location` (text, nullable)
- `window_start` (date) — first selectable day of the candidate range
- `window_end` (date) — last selectable day of the candidate range
- `status` (enum: `open` | `closed` | `finalized`)
- `finalized_date` (date, nullable) — set when status = `finalized`
- `auto_approve_members` (bool, default **false**) — when true, new entry
  requests are approved automatically (see
  [auto-approval](#auto-approving-new-members))
- `created_at`, `updated_at`
- **Validation:** `window_end >= window_start` and the span
  `window_end - window_start` **must not exceed 6 months**.

### `event_memberships`
Controls who may enter an event. One row per (user, event) once a user requests
access.
- `id` (uuid, pk)
- `event_id` (fk → events.id, on delete cascade)
- `user_id` (fk → users.id, on delete cascade)
- `status` (enum: `pending` | `approved` | `rejected`)
- `requested_at` (timestamptz)
- `decided_at` (timestamptz, nullable)
- `decided_by` (fk → users.id, nullable) — the admin who approved/rejected
- **Unique constraint:** (`event_id`, `user_id`)

Only users with an `approved` membership may read an event's date page or write
`availabilities`. The event's creator (admin) is implicitly approved.

A `rejected` user may **request again**: re-requesting flips their existing row
back to `pending` (with a fresh `requested_at`), rather than inserting a new
row — so the (`event_id`, `user_id`) uniqueness holds.

#### Auto-approving new members

Each event has an `auto_approve_members` flag (per-event granularity; there is
no global setting). Default is **false** — manual approval, today's behavior.

**When the flag is ON:**
- A **first-time** entry request is created directly with `status = approved`.
  For such rows, `decided_at = requested_at` and `decided_by` is **null** —
  a null `decided_by` on an approved row is how the system marks "approved
  automatically" (manual decisions always record the deciding admin).
- The requesting user gets access immediately: the list row links through to
  the date page with no "awaiting approval" interstitial.
- **Exception — previously rejected users:** a re-request from a user whose
  membership is `rejected` goes to `pending` for manual review, even with the
  flag on. A rejection is an explicit admin decision and auto-approve does not
  override it.
- The flag applies to any non-deleted event **regardless of `status`**
  (`open`, `closed`, or `finalized`): entering only grants access to view the
  page/ranking, and voting rights are already governed by event status.

**Toggling:**
- Only an admin can set the flag, at event creation or any time after, from the
  event's admin controls ([§5.2](#52-date-page)).
- Turning the flag **ON** also **immediately approves all currently `pending`
  requests** for that event (these are recorded as auto-approvals:
  `decided_at = now()`, `decided_by = null`). The UI states this before the
  admin confirms.
- Turning the flag **OFF** only affects future requests; memberships already
  approved (manually or automatically) are untouched.

### `availabilities`
One row per (user, event, day) that a user marks as available.
- `id` (uuid, pk)
- `event_id` (fk → events.id, on delete cascade)
- `user_id` (fk → users.id, on delete cascade)
- `day` (date) — must fall within the event's `[window_start, window_end]`
- `created_at`
- **Unique constraint:** (`event_id`, `user_id`, `day`)

The ranking is derived: `COUNT(*) GROUP BY day` over an event's availabilities,
ordered descending.

> **Holidays are not stored per-event.** Brazilian holidays are computed/looked
> up at render time (see [§5.2](#52-date-page)), not persisted, so the holiday
> set stays correct without data migrations.

## 5. Screens

### 5.1 Main page (`/`)
- **Logged out:** app intro + "Log in" (Auth0). The event list is not shown, or
  shown as a teaser without links.
- **Logged in:** list of **all** events, each showing title, date window, status,
  and (if finalized) the chosen date. Each row reflects the viewer's membership
  state:
  - No membership → "Request to enter" action. On an event with
    [auto-approval](#auto-approving-new-members) enabled this approves
    instantly and the row becomes a link to the date page (optionally labeled
    "Join" instead of "Request to enter" to set expectations).
  - `pending` → shows "Awaiting approval" (no entry yet).
  - `approved` → row links through to the date page.
  - `rejected` → shown as not accessible, with a "Request again" action that
    returns the row to `pending`.
- Admins additionally see a "Create event" action and, for events they manage, a
  count/entry point for **pending access requests**.

### 5.2 Date page (`/events/[id]`)
The core screen. A **calendar view** covering the event's date window.
**Access-gated:** only users with an `approved` membership (or the admin) reach
this page; anyone else is redirected back to the list with their request status.

**Availability marking**
- Each day in the window is toggleable by the logged-in user (available / not).
- The user's own selections are visually distinct from the aggregate.
- Selections persist immediately (optimistic update, then write to Supabase).
- Days outside `[window_start, window_end]` are non-interactive.

**Ranking panel**
- A ranked list of days by number of available users (most-voted first).
- Reflects all participants' availability, updating as votes change.
- Shows the count (and optionally who) per day.

**Calendar coloring**
- **Weekends** (Sat/Sun) rendered in a distinct color.
- **Brazilian national holidays** rendered in a distinct color, with the holiday
  name on hover/label. Holidays are **computed in-app** (no external API): a
  table of fixed-date national holidays plus movable feasts derived from Easter
  (computed via an Easter/Computus algorithm — e.g. Carnaval, Sexta-feira Santa,
  Corpus Christi). Scope is **national** holidays in v1; state/municipal holidays
  are out of scope.
- Precedence when a day is multiple things: holiday > weekend > weekday.

**Admin controls (on this page, admin only)**
- Review **pending access requests** and approve/reject them.
- Toggle **auto-approve new members** for this event (also settable on the
  event creation form, default off). Turning it on warns that all currently
  pending requests will be approved, then approves them (see
  [auto-approval](#auto-approving-new-members)).
- Close voting (reversible — a `closed` event can be reopened), and finalize a
  specific date (typically the top-ranked one).
- Note: **finalizing is one-way** in v1 — a `finalized` event cannot be
  re-opened.

## 6. Authentication & identity

- **Auth0** is the source of truth for authentication and user identity.
- On login, the Next.js server verifies the Auth0 session and **upserts** the
  user into Supabase `users` keyed by `auth0_sub`, syncing email/name.
- The app accesses Supabase **from Next.js server code using the Supabase
  service role key** (never exposed to the browser). All reads/writes go through
  server actions / route handlers that first resolve the current Auth0 user.
- Authorization (admin vs participant, "only edit your own availability") is
  enforced in that server layer, since Supabase is not receiving the Auth0 JWT
  directly in this model.

> **Trade-off noted:** this "service-role + server-side checks" approach is the
> simplest to reason about and keeps Auth0 as the single identity authority. It
> does **not** use Supabase Row Level Security — so every data-access path must
> go through the server and apply checks. An alternative (Auth0 JWT + Supabase
> RLS) was considered and deferred; revisit if we ever want the browser to talk
> to Supabase directly.

## 7. Tech stack & conventions

- **Framework:** Next.js **16** (App Router), React **19**, TypeScript,
  Tailwind CSS **4**.
- **Auth:** Auth0.
- **Data:** Supabase (Postgres), accessed server-side via service role.
- ⚠️ **This project uses a non-standard Next.js** (see `AGENTS.md`). Before
  writing implementation code, read the relevant guide in
  `node_modules/next/dist/docs/` — APIs, routing, and conventions may differ
  from prior Next.js knowledge. Heed deprecation notices.

## 8. Resolved decisions

- **Event visibility:** all events are visible to every logged-in user; an admin
  approves who may *enter* each event (see `event_memberships`, [§3](#3-roles--permissions), [§5](#5-screens)).
- **Re-opening:** a `closed` event can be reopened by an admin (closed ↔ open);
  a `finalized` event cannot. *(Revised 2026-07-04 — closing was originally
  one-way.)*
- **Window size cap:** the date window may span at most **6 months**.
- **Holiday source:** Brazilian national holidays are **computed in-app** (fixed
  dates + Easter-derived movable feasts), no external API.

- **Auto-approving new members** *(added 2026-07-04)*: per-event flag
  (`events.auto_approve_members`), **off by default** for new events. Enabling
  it **retroactively approves** that event's pending requests; a previously
  **rejected** user who re-requests still goes to `pending` even with the flag
  on; the flag applies to any non-deleted event **regardless of status**
  (open/closed/finalized). Auto-approvals are recorded with
  `decided_by = null`. See [auto-approval](#auto-approving-new-members).
- **Notifying an approved user:** no in-app notifications in v1. For the current
  scope (a closed friends group) the admin messages people out-of-band; a user
  otherwise learns of approval by revisiting the list. In-app notifications are
  [future work](#9-future-work).

## 9. Future work

- **Recurring events / series ("future iterations"):** model an event as a
  series with linked dated instances, each with its own voting round and shared
  history. This is the headline follow-up and the reason the schema keeps
  `events` as standalone rows that a future `series_id` can group.
- **In-app notifications:** notify a user when their access request is
  approved/rejected, and when voting opens or a date is finalized. (For v1's
  closed friends group, the admin just messages people directly.)
- Self-service event creation for non-admins (or an "organizer" role).
- Time-of-day availability granularity.
