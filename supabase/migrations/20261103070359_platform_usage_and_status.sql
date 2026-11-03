-- What QuiroFlow itself spends on its providers, for the admin panel
-- (quiroflow-admin), which reads both tables with the service role.
--
-- ai_usage: one row per successful Anthropic Messages call, written by
-- server/utils/anthropicClient.ts. The tokens are recorded rather than a cost
-- so a price change never needs a migration; the admin panel prices them.
-- The receptionist answers on QuiroFlow's own API key for every clinic, so
-- this is the only place that says which clinic and which feature spent it.
--
-- platform_status: small facts about the providers, one row per key, each
-- written by one piece of code:
--   anthropic.credit_error  last "credit balance too low" refusal (anthropicClient.ts)
--   anthropic.balance       the balance an admin read off the Console, and when (admin panel)
--   resend.quota            Resend's own used-today / used-this-month headers (resend.ts)
--   alert:<name>            when an ops alert email last went out (opsAlert.ts)

create table ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Set null, not cascade: deleting a clinic must not make what was already
  -- spent on it disappear from the platform's totals.
  account_id uuid references accounts(id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0
);

create index ai_usage_created_at on ai_usage (created_at);
create index ai_usage_account_created_at on ai_usage (account_id, created_at);

-- No policies and no grant to authenticated: nothing but the service role
-- reads or writes it. A clinic has no business seeing what another one spent.
-- table-grants-ok: ai_usage: service role only, written by the server, read by the admin panel
alter table ai_usage enable row level security;
select public.require_two_factor_on('public.ai_usage');
grant select, insert, update, delete on table ai_usage to service_role;
grant usage on sequence ai_usage_id_seq to service_role;

create table platform_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- table-grants-ok: platform_status: service role only, as ai_usage
alter table platform_status enable row level security;
select public.require_two_factor_on('public.platform_status');
grant select, insert, update, delete on table platform_status to service_role;

-- ai_usage summed for the admin panel since a given moment, as one jsonb
-- value: by Madrid day, by clinic and by feature, each split by model because
-- each model has its own price. One value rather than rows, because rows
-- (day x clinic x feature x model) pass PostgREST's 1,000-row cap within a
-- month, and a cap that silently drops rows under-reports what was spent.
create or replace function public.ai_usage_summary(p_since timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with u as (
    select (created_at at time zone 'Europe/Madrid')::date as day, account_id, feature, model,
           input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
    from public.ai_usage
    where created_at >= p_since
  ),
  totals as (
    select 'day' as dim, day::text as k, model, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
           sum(cache_creation_input_tokens) as cache_creation_input_tokens, sum(cache_read_input_tokens) as cache_read_input_tokens
    from u group by day, model
    union all
    select 'account', account_id::text, model, count(*), sum(input_tokens), sum(output_tokens), sum(cache_creation_input_tokens), sum(cache_read_input_tokens)
    from u group by account_id, model
    union all
    select 'feature', feature, model, count(*), sum(input_tokens), sum(output_tokens), sum(cache_creation_input_tokens), sum(cache_read_input_tokens)
    from u group by feature, model
  )
  select coalesce(jsonb_agg(to_jsonb(totals)), '[]'::jsonb) from totals
$$;

revoke all on function public.ai_usage_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_usage_summary(timestamptz) to service_role;
