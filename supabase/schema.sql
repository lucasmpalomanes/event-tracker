-- Event Tracker schema — mirrors specs/spec.md §4.
-- Run this in the Supabase SQL editor (or as a migration).
-- RLS is intentionally left disabled: all access goes through
-- server-side code that resolves the Auth0 user first (see specs/spec.md §6).

create extension if not exists "pgcrypto";

-- users -----------------------------------------------------------------
-- Mirror of Auth0 identities, synced on first login.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text not null unique,
  email text not null,
  name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- events ------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users (id),
  title text not null,
  description text,
  location text,
  window_start date not null,
  window_end date not null,
  status text not null default 'open'
    check (status in ('open', 'closed', 'finalized')),
  finalized_date date,
  auto_approve_members boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_window_valid check (window_end >= window_start),
  constraint events_window_max_6_months
    check (window_end <= window_start + interval '6 months')
);

-- Upgrade path for databases created before auto-approve existed
-- (create table if not exists above won't add the column).
alter table events
  add column if not exists auto_approve_members boolean not null default false;

-- event_memberships ---------------------------------------------------------
-- Controls who may enter an event. One row per (user, event) once requested.
create table if not exists event_memberships (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users (id),
  unique (event_id, user_id)
);

-- availabilities ------------------------------------------------------------
-- One row per (user, event, day) that a user marks as available.
create table if not exists availabilities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id, day)
);

-- Enforce that a marked day falls within its event's window.
create or replace function check_availability_within_window()
returns trigger as $$
begin
  if not exists (
    select 1 from events
    where id = new.event_id
      and new.day between window_start and window_end
  ) then
    raise exception 'day % is outside the event window', new.day;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists availabilities_within_window on availabilities;
create trigger availabilities_within_window
  before insert or update on availabilities
  for each row execute function check_availability_within_window();

-- Helpful indexes for the ranking query and membership lookups.
create index if not exists availabilities_event_day_idx
  on availabilities (event_id, day);

create index if not exists event_memberships_event_status_idx
  on event_memberships (event_id, status);
