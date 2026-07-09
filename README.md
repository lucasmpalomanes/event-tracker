# Event Tracker

Pick the best date for a group event. An admin creates an event with a
candidate date window; participants mark the days they're available on a
calendar (weekends and Brazilian national holidays highlighted), and a live
ranking shows the most-voted days so the admin can finalize one.

Full product spec: [`specs/spec.md`](./specs/spec.md). All specs live in [`specs/`](./specs/).

## Stack

- [Next.js 16](https://nextjs.org) (App Router) · React 19 · TypeScript · Tailwind CSS 4
- [Auth0](https://auth0.com) for authentication (`@auth0/nextjs-auth0`)
- [Supabase](https://supabase.com) (Postgres) for storage — accessed
  server-side only, with the secret key; no RLS (see spec §6)

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql)
   (choose "Run without RLS" if prompted — access control lives in the
   server code, per spec §6).
3. From **Project Settings → API**, copy the Project URL, publishable key,
   and secret key.

### 2. Auth0

1. Create a **Regular Web Application** at [auth0.com](https://auth0.com).
2. In its Settings, set:
   - Allowed Callback URLs: `http://localhost:3000/auth/callback`
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`
3. Copy the Domain, Client ID, and Client Secret.

### 3. Environment

```bash
cp .env.example .env.local
# fill in the values; generate AUTH0_SECRET with:
openssl rand -hex 32
```

### 4. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), log in, then make your
user an admin so you can create events:

```sql
update users set is_admin = true where email = 'you@example.com';
```

## Project layout

| Path | Purpose |
|---|---|
| `specs/spec.md` | Product spec — roles, data model, screens, decisions |
| `specs/shadcn-refactor.md` | UI refactor spec — migrate components to shadcn/ui |
| `specs/pix-payments.md` | Pix payments spec — per-participant charges on finalized events |
| `specs/event-budget.md` | Budget tab spec — itemized costs, per-person shares, feeds Pix pricing |
| `supabase/schema.sql` | Database schema (run in Supabase SQL editor) |
| `proxy.ts` | Auth0 session handling (Next 16's renamed middleware) |
| `lib/dal.ts` | Auth gate: Auth0 session → Supabase user sync |
| `lib/events.ts` | Event/membership/availability queries + access rules |
| `lib/holidays.ts` | Brazilian national holidays, computed in-app |
| `app/actions.ts` | All mutations (Server Actions, each re-checks auth) |
| `components/ui/` | shadcn/ui primitives (CLI-generated — don't hand-edit) |
| `components/` | Shared app components (voting calendar, confirm-action button) |
| `app/page.tsx` | Event list with per-user membership state |
| `app/events/new/` | Event creation (admin) |
| `app/events/[id]/` | Date page: calendar, voting, ranking, admin controls |

## Deployment (Vercel)

Deployed as its own Vercel project at `https://gagasco.paloman.es`.

1. Import the GitHub repo as a new Vercel project (framework: Next.js,
   no build config changes needed).
2. **Settings → Environment Variables**: add everything from
   `.env.example`, with `APP_BASE_URL=https://gagasco.paloman.es`.
3. **Settings → Domains**: add `gagasco.paloman.es` (DNS is automatic if
   the apex domain is already on Vercel).
4. In Auth0, append the production URLs to the existing localhost ones
   (comma-separated):
   - Allowed Callback URLs: `https://gagasco.paloman.es/auth/callback`
   - Allowed Logout URLs: `https://gagasco.paloman.es`
   - Allowed Web Origins: `https://gagasco.paloman.es`

Supabase needs no changes — it is only accessed server-side.

## Conventions

⚠️ This project pins a Next.js version with breaking changes from common
conventions (e.g. `middleware.ts` → `proxy.ts`). Before writing code, check
the guides in `node_modules/next/dist/docs/` — see [`AGENTS.md`](./AGENTS.md).
