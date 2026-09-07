-- Developer API v1: everything the public REST surface needs that the
-- WhatsApp-only first version (0064) didn't.
--
-- Three additions:
--   1. api_tokens grows the fields the docs portal promises -- an app
--      identity (so a clinic can tell which integration a token belongs to
--      when reading its usage log) and an optional expiry.
--   2. api_rate_limits + consume_api_rate_limit(): a fixed-window counter
--      that has to live in Postgres rather than process memory, because
--      Nitro runs on Netlify Functions -- consecutive requests routinely
--      land on different instances, so an in-process Map would let a caller
--      exceed the limit simply by being unlucky about which lambda answered.
--   3. api_request_logs: what Settings > Developers renders as the usage
--      log, and the only way a clinic can see that a token they issued is
--      being used and for what.

-- ---------------------------------------------------------------------
-- 1. Token metadata
-- ---------------------------------------------------------------------

-- Mirrors the x-app-details header PracticeHub asks integrators to send:
-- who built this and how to reach them. Recorded once at token creation
-- instead of on every request, since it never varies per call.
alter table api_tokens add column if not exists app_name text;
alter table api_tokens add column if not exists app_contact text;
alter table api_tokens add column if not exists expires_at timestamptz;

-- The 0064 default ('{whatsapp:send}') was right when send was the only
-- endpoint. New tokens now pick their own scopes in the UI, so a default
-- that silently grants one is worse than a default that grants nothing.
alter table api_tokens alter column scopes set default '{}';

-- ---------------------------------------------------------------------
-- 2. Rate limiting
-- ---------------------------------------------------------------------

create table if not exists api_rate_limits (
  token_id uuid primary key references api_tokens(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

-- No RLS policies and no grants: only the service role (which bypasses RLS)
-- ever touches this, via the function below. There is nothing here a signed
-- in staff member needs to read.
alter table api_rate_limits enable row level security;

-- Atomically counts one request against the token's current window and says
-- whether it's allowed. The whole thing is a single INSERT .. ON CONFLICT so
-- two concurrent requests can't both read a stale count and both decide
-- they're under the limit -- the row lock the upsert takes serialises them.
create or replace function consume_api_rate_limit(
  p_token_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
begin
  insert into api_rate_limits (token_id, window_started_at, request_count)
  values (p_token_id, v_now, 1)
  on conflict (token_id) do update
    set
      -- Window expired -> start a fresh one at now() with this request as
      -- its first. Still open -> keep the start and increment.
      window_started_at = case
        when api_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then v_now
        else api_rate_limits.window_started_at
      end,
      request_count = case
        when api_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then 1
        else api_rate_limits.request_count + 1
      end
  returning api_rate_limits.window_started_at, api_rate_limits.request_count
  into v_window_start, v_count;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke execute on function consume_api_rate_limit(uuid, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Request log
-- ---------------------------------------------------------------------

create table if not exists api_request_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_id uuid references api_tokens(id) on delete set null,
  request_id text not null,
  method text not null,
  path text not null,
  status_code integer not null,
  duration_ms integer,
  -- Only set on 4xx/5xx: the message the caller got back, so a clinic can
  -- see *why* an integration is failing without the developer having to
  -- forward their own logs.
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists api_request_logs_account_idx on api_request_logs (account_id, created_at desc);
create index if not exists api_request_logs_token_idx on api_request_logs (token_id, created_at desc);

alter table api_request_logs enable row level security;

-- Read-only to staff, and gated behind the same permission that governs the
-- tokens themselves -- the log shows which endpoints an integration touches,
-- which is the same sensitivity as the token list. Writes are service-role
-- only (the API writes its own log; nobody should be able to forge entries).
create policy "developers read api_request_logs" on api_request_logs
  for select using (is_account_member(account_id) and has_permission(account_id, 'developers_access'));

-- ---------------------------------------------------------------------
-- 4. Clinic timezone
-- ---------------------------------------------------------------------

-- Needed by GET /api/public/v1/availability, which has to turn a clinic's
-- business_hours (wall-clock strings like "09:00") into real instants.
-- The booking page gets away without this because it runs in the visitor's
-- browser and quietly assumes the visitor sits in the clinic's timezone;
-- an API called from a server in another region has no such luck, and would
-- otherwise offer 09:00 UTC slots to a clinic that opens at 09:00 CET.
--
-- Europe/Madrid as the default matches where every account currently is.
-- Clinics elsewhere set it explicitly; it is returned by GET /clinics so an
-- integration can render times correctly rather than guessing.
alter table clinics add column if not exists timezone text not null default 'Europe/Madrid';

-- ---------------------------------------------------------------------
-- 5. Appointment source
-- ---------------------------------------------------------------------

-- Bookings made through the public API are neither 'staff' (nobody sat at
-- the calendar) nor 'online' (which specifically means the clinic's own
-- booking page, and is what the online-booking reports count). Folding API
-- bookings into either would quietly corrupt those reports the first time a
-- clinic connects an AI receptionist, so they get their own value.
alter table appointments drop constraint if exists appointments_source_check;
alter table appointments add constraint appointments_source_check
  check (source in ('staff', 'online', 'api'));

-- ---------------------------------------------------------------------
-- 6. Restore the appointment.deleted webhook
-- ---------------------------------------------------------------------

-- appointment.deleted (0022) fires AFTER DELETE. Migration 0102 then turned
-- deletion into a soft delete -- the Calendar's "Delete" now sets deleted_at
-- rather than removing the row -- so no DELETE has fired since, and the event
-- has been silently dead ever since: still offered in Settings > Webhooks,
-- still selectable, never delivered.
--
-- Found while documenting the event list for the developer portal, which is
-- the point at which "we advertise this" and "this works" have to agree.
--
-- The WHEN clause keeps the transition test in the trigger rather than adding
-- another special case inside fn_dispatch_webhook_event, and means the event
-- fires once, on the null -> not-null edge, not on every later edit of an
-- already-deleted appointment.
--
-- The original AFTER DELETE trigger stays: a genuine hard delete (a data
-- cleanup, a cascade) should still be observable.
create trigger trg_webhook_appointment_soft_deleted
  after update on appointments
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function fn_dispatch_webhook_event('appointment.deleted');
