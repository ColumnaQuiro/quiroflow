-- Imports that run on the server, not in a browser tab.
--
-- The Quirocitas importer used to be a loop in the browser: thousands of page
-- loads through /api/import/quirocitas (about ten minutes for 1,900 patients),
-- a copy of the clinic kept in IndexedDB, and every import step written from
-- that tab. Closing the tab stopped it. Now the browser only asks for the work
-- (import_jobs) and watches it; server/utils/importJobs.ts does it in slices
-- that each fit inside a function's time limit, and emails whoever started it
-- when it finishes.
--
-- import_snapshots is the copy that used to live in IndexedDB: one row per
-- patient record read from Quirocitas, plus a few rows for the rest. Only the
-- server reads or writes it (no policies: the service role bypasses RLS and
-- nobody else gets in). It holds patient data, so it is deleted with
-- "Delete the copy" on the Read step, and import-jobs-cron removes any copy
-- nobody has read again for 30 days.

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- The clinic appointments are booked into. Chosen in the clinic switcher
  -- when the job is started, as the browser importer used to read it.
  clinic_id uuid references public.clinics(id) on delete set null,
  source text not null check (source in ('quirocitas')),
  -- What to do, in order: 'read' and/or import steps. A full import is all of
  -- them; the step-by-step screens start a job of one.
  steps text[] not null check (cardinality(steps) > 0),
  -- { lang, quietUpcoming, fromScratch }
  options jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  step_index integer not null default 0,
  -- Where the current step stands, for the progress bar and for the next
  -- slice to carry on from.
  progress jsonb not null default '{}'::jsonb,
  -- One entry per finished step: { step, written, errors, warnings }.
  results jsonb not null default '[]'::jsonb,
  error text,
  cancel_requested boolean not null default false,
  started_by uuid references public.team_members(id) on delete set null,
  -- Held by the slice working on it, so the cron and a slice's own hand-off
  -- never run the same job twice at once.
  locked_until timestamptz,
  slices integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  notified_at timestamptz
);

-- One job at a time per clinic and source: two would read the same
-- Quirocitas session and write the same rows.
create unique index import_jobs_one_active on public.import_jobs (account_id, source)
  where status in ('queued', 'running');
create index import_jobs_active on public.import_jobs (status) where status in ('queued', 'running');
create index import_jobs_account on public.import_jobs (account_id, created_at desc);

alter table public.import_jobs enable row level security;

-- Read-only to the people who may import (Settings > Import is gated on
-- data_admin). Every write goes through /api/import/jobs with the service role.
create policy "staff select import_jobs" on public.import_jobs for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'data_admin'));

select public.require_two_factor_on('public.import_jobs');
select public.grant_data_api('public.import_jobs');

create table public.import_snapshots (
  account_id uuid not null references public.accounts(id) on delete cascade,
  source text not null check (source in ('quirocitas')),
  -- 'meta' (everything but the records), 'list' (the patient list of the read
  -- in progress), 'ledger_partial' (the cash ledger walked so far), or
  -- 'patient:<id>'.
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, source, key)
);

-- Granted like every table, and still closed: RLS is on with no policy, so
-- only the service role sees a row.
alter table public.import_snapshots enable row level security;
select public.require_two_factor_on('public.import_snapshots');
select public.grant_data_api('public.import_snapshots');
