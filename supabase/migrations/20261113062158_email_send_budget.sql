-- The daily email budget, and the queue a campaign waits in when it is spent.
--
-- Resend's free plan sends 100 emails a day and Brevo's 300, and past that
-- each one refuses. A campaign to a clinic's whole patient list used to be
-- walked straight through: the first ~400 went out, every one after that
-- failed three times and stopped -- and so, for the rest of the day, did the
-- appointment confirmations and reminders, which share the same quota.
--
-- Now a campaign's emails (a marketing automation, or one sent to a segment or
-- list) take a slot from the day's budget before they are sent, and a run that
-- finds none left waits -- automation_sequence_runs.waiting_for =
-- 'email_quota' -- and carries on the next day from the same step. The runs
-- table is the queue: nothing is copied out of it, so the consent checks and
-- the stop conditions apply at the moment of sending, exactly as before.
--
-- email_daily_usage   one row per UTC day (Resend's daily quota resets at
--                     00:00 UTC): what each provider has taken, split into
--                     transactional and campaign sends, and when a provider
--                     refused on quota.
-- email_bulk_usage    one row per clinic per day: its campaign sends, and how
--                     often it was told to wait. What keeps one clinic's 900
--                     emails from taking every slot for three days while
--                     another clinic's campaign of 40 waits behind it.
--
-- The limits themselves are not stored here: they are runtime config
-- (NUXT_EMAIL_DAILY_LIMIT_RESEND, NUXT_EMAIL_DAILY_LIMIT_BREVO,
-- NUXT_EMAIL_TRANSACTIONAL_RESERVE), passed into claim_bulk_email on every
-- call, so moving to a paid plan is an environment change and not a migration.

create table public.email_daily_usage (
  day date primary key,
  resend_sent integer not null default 0,
  brevo_sent integer not null default 0,
  -- Resend's own count (x-resend-daily-quota), which also includes what was
  -- sent on the same key from elsewhere -- Supabase Auth's SMTP, for one.
  resend_observed integer,
  resend_exhausted_at timestamptz,
  brevo_exhausted_at timestamptz,
  transactional_sent integer not null default 0,
  bulk_sent integer not null default 0,
  updated_at timestamptz not null default now()
);

-- table-grants-ok: email_daily_usage: service role only, written by deliverEmail, read by the admin panel
alter table public.email_daily_usage enable row level security;
select public.require_two_factor_on('public.email_daily_usage');
grant select, insert, update, delete on table public.email_daily_usage to service_role;

create table public.email_bulk_usage (
  day date not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent integer not null default 0,
  deferred integer not null default 0,
  primary key (day, account_id)
);

create index email_bulk_usage_account on public.email_bulk_usage (account_id);

-- table-grants-ok: email_bulk_usage: service role only, as email_daily_usage
alter table public.email_bulk_usage enable row level security;
select public.require_two_factor_on('public.email_bulk_usage');
grant select, insert, update, delete on table public.email_bulk_usage to service_role;

-- Runs parked on the budget, found by claim_bulk_email to decide whether
-- anybody else is waiting. The existing (account_id, waiting_for) index leads
-- with the account, which this question does not have.
create index automation_sequence_runs_email_quota_idx
  on public.automation_sequence_runs (account_id)
  where status = 'running' and waiting_for = 'email_quota';

-- ------------------------------------------------------------------ recording

create or replace function public.email_budget_day()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'utc')::date $$;

/** One email that went out. p_kind 'bulk' was already counted when it claimed its slot. */
create or replace function public.record_email_sent(p_provider text, p_kind text)
returns void
language sql
set search_path = ''
as $$
  insert into public.email_daily_usage as u (day, resend_sent, brevo_sent, transactional_sent)
  values (
    public.email_budget_day(),
    (p_provider = 'resend')::int,
    (p_provider = 'brevo')::int,
    (p_kind = 'transactional')::int
  )
  on conflict (day) do update set
    resend_sent = u.resend_sent + excluded.resend_sent,
    brevo_sent = u.brevo_sent + excluded.brevo_sent,
    transactional_sent = u.transactional_sent + excluded.transactional_sent,
    updated_at = now();
$$;

/** Resend's own used-today count, from its response headers. Only ever raises it. */
create or replace function public.observe_resend_daily_usage(p_used integer)
returns void
language sql
set search_path = ''
as $$
  insert into public.email_daily_usage as u (day, resend_observed)
  values (public.email_budget_day(), p_used)
  on conflict (day) do update set
    resend_observed = greatest(coalesce(u.resend_observed, 0), excluded.resend_observed),
    updated_at = now();
$$;

/** A provider refused on quota: for the rest of the day it is worth what it has already taken. */
create or replace function public.mark_email_provider_exhausted(p_provider text)
returns void
language sql
set search_path = ''
as $$
  insert into public.email_daily_usage as u (day, resend_exhausted_at, brevo_exhausted_at)
  values (
    public.email_budget_day(),
    case when p_provider = 'resend' then now() end,
    case when p_provider = 'brevo' then now() end
  )
  on conflict (day) do update set
    resend_exhausted_at = coalesce(u.resend_exhausted_at, excluded.resend_exhausted_at),
    brevo_exhausted_at = coalesce(u.brevo_exhausted_at, excluded.brevo_exhausted_at),
    updated_at = now();
$$;

-- ------------------------------------------------------------------- claiming

/**
 * Takes one slot of today's campaign budget for a clinic, or says why not:
 *
 *   'ok'     take it; the email is counted from now (release_bulk_email if
 *            it does not go out after all)
 *   'share'  there is budget, but this clinic has had its fair share of it and
 *            another clinic's campaign is waiting: try again shortly
 *   'full'   today's campaign budget is spent: try again tomorrow
 *
 * The budget: what the providers allow today (a limit of null means "no daily
 * limit"; a provider that has refused on quota counts only what it took),
 * less what transactional email has used or the reserve kept for it,
 * whichever is larger. So a campaign can never eat the slots the day's
 * confirmations and reminders need, and once they have used more than their
 * reserve, campaigns get less.
 *
 * The fair share is the budget split evenly between the clinics that have
 * sent or waited today. It only binds while some OTHER clinic has a run
 * waiting on the budget: a clinic on its own takes everything there is.
 *
 * The row lock on today's email_daily_usage is what makes concurrent claims
 * take turns, so the day never goes over by a race.
 */
create or replace function public.claim_bulk_email(
  p_account_id uuid,
  p_resend_limit integer,
  p_brevo_limit integer,
  p_reserve integer
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  d date := public.email_budget_day();
  u public.email_daily_usage;
  resend_taken integer;
  capacity bigint;
  transactional bigint;
  ceiling bigint;
  active integer;
  mine integer;
  others_waiting boolean;
begin
  insert into public.email_daily_usage (day) values (d) on conflict (day) do nothing;
  insert into public.email_bulk_usage (day, account_id) values (d, p_account_id) on conflict do nothing;

  select * into u from public.email_daily_usage where day = d for update;

  resend_taken := greatest(u.resend_sent, coalesce(u.resend_observed, 0));
  capacity :=
    (case when u.resend_exhausted_at is not null then resend_taken else coalesce(p_resend_limit, 1000000000) end)::bigint
    + (case when u.brevo_exhausted_at is not null then u.brevo_sent else coalesce(p_brevo_limit, 0) end)::bigint;
  -- Sent on the Resend key from elsewhere counts as transactional: it is
  -- not ours to defer.
  transactional := u.transactional_sent + greatest(0, coalesce(u.resend_observed, 0) - u.resend_sent);
  ceiling := capacity - greatest(transactional, coalesce(p_reserve, 0));

  if u.bulk_sent >= ceiling then
    update public.email_bulk_usage set deferred = deferred + 1 where day = d and account_id = p_account_id;
    return 'full';
  end if;

  select count(*) into active from public.email_bulk_usage where day = d and (sent > 0 or deferred > 0 or account_id = p_account_id);
  select sent into mine from public.email_bulk_usage where day = d and account_id = p_account_id;
  if active > 1 and mine >= ceil(ceiling::numeric / active) then
    select exists (
      select 1 from public.automation_sequence_runs r
      where r.status = 'running' and r.waiting_for = 'email_quota' and r.account_id <> p_account_id
    ) into others_waiting;
    if others_waiting then
      update public.email_bulk_usage set deferred = deferred + 1 where day = d and account_id = p_account_id;
      return 'share';
    end if;
  end if;

  update public.email_daily_usage set bulk_sent = bulk_sent + 1, updated_at = now() where day = d;
  update public.email_bulk_usage set sent = sent + 1 where day = d and account_id = p_account_id;
  return 'ok';
end;
$$;

/** Gives back a slot claim_bulk_email handed out, for an email that did not go out after all. */
create or replace function public.release_bulk_email(p_account_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.email_daily_usage set bulk_sent = greatest(0, bulk_sent - 1), updated_at = now()
  where day = public.email_budget_day();
  update public.email_bulk_usage set sent = greatest(0, sent - 1)
  where day = public.email_budget_day() and account_id = p_account_id;
$$;

-- Server-only: a clinic calling these through the REST API could spend, or
-- refill, every other clinic's budget.
revoke execute on function public.record_email_sent(text, text) from public, anon, authenticated;
revoke execute on function public.observe_resend_daily_usage(integer) from public, anon, authenticated;
revoke execute on function public.mark_email_provider_exhausted(text) from public, anon, authenticated;
revoke execute on function public.claim_bulk_email(uuid, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.release_bulk_email(uuid) from public, anon, authenticated;
grant execute on function public.record_email_sent(text, text) to service_role;
grant execute on function public.observe_resend_daily_usage(integer) to service_role;
grant execute on function public.mark_email_provider_exhausted(text) to service_role;
grant execute on function public.claim_bulk_email(uuid, integer, integer, integer) to service_role;
grant execute on function public.release_bulk_email(uuid) to service_role;
