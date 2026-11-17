-- GoCardless: the gaps between phase 1 and GoCardless's partner integration
-- guide (what their review checks).

-- ---------------------------------------------------------------------
-- The mandate reference
-- ---------------------------------------------------------------------
-- What the patient sees on their bank statement, and what GoCardless's
-- support asks for. Shown on the patient's direct-debit block. Rows matched
-- before this column existed are filled in the next time Settings > Import
-- lists the mandates, or when a mandate event arrives.
alter table public.patient_gocardless_mandates add column reference text;

-- ---------------------------------------------------------------------
-- Pairing from the customer's metadata
-- ---------------------------------------------------------------------
-- Pairing a mandate now writes our patient id into the GoCardless customer's
-- metadata (quiroflow_patient_id), and the import list reads it back: a
-- customer carrying it was confirmed by a person before, so it is the
-- strongest suggestion there is. 'metadata' records that it came from there.
alter table public.patient_gocardless_mandates drop constraint patient_gocardless_mandates_matched_by_check;
alter table public.patient_gocardless_mandates add constraint patient_gocardless_mandates_matched_by_check
  check (matched_by in ('email', 'phone', 'name', 'manual', 'link', 'metadata'));

-- ---------------------------------------------------------------------
-- Every webhook event, handled once
-- ---------------------------------------------------------------------
-- GoCardless delivers at least once, retries a failed batch whole, and the
-- reconcile cron replays three days of events every night. The handlers
-- were already idempotent where they book money; this makes every event a
-- no-op the second time, whatever its type, so a replay neither re-reads
-- GoCardless for nothing nor repeats a side effect a handler does not guard.
-- Written only by the server, after an event was handled without error: a
-- failed one stays unrecorded and is tried again. The one event GoCardless
-- sends without an id (organisations/disconnected) is not recorded at all;
-- forgetting a connection twice is harmless. The reconcile cron prunes rows
-- older than GoCardless's retry window and its own replay window.
create table public.gocardless_processed_events (
  account_id uuid not null references public.accounts(id) on delete cascade,
  gocardless_event_id text not null,
  resource_type text,
  action text,
  processed_at timestamptz not null default now(),
  primary key (account_id, gocardless_event_id)
);
create index gocardless_processed_events_processed_at_idx on public.gocardless_processed_events (processed_at);
select public.grant_data_api('public.gocardless_processed_events');

-- Server only: no staff policy, so only the service role reads or writes it.
alter table public.gocardless_processed_events enable row level security;
select public.require_two_factor_on('public.gocardless_processed_events');
