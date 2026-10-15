-- Charging the receptionist's replies past the monthly allowance.
--
-- 1,000 replies a month are included; each further 1,000, or part of one, is
-- EUR 15 + IVA (20261014184755_receptionist_addon.sql). On the 1st,
-- receptionist-overage-cron reads last month's count per account
-- (20261015051008_receptionist_reply_allowance.sql) and issues a Stripe
-- invoice for the blocks past the allowance.
--
-- One row per account and month, written BEFORE Stripe is called, so the
-- unique key is what makes the charge happen once: a re-run, a retried
-- request or two ticks at once find the row and do not invoice again. The
-- Stripe calls carry idempotency keys of their own for the case in between --
-- row written, invoice not yet recorded on it.
create table receptionist_overage_charges (
  account_id uuid not null references accounts(id) on delete cascade,
  -- The first day of the month charged for, on the clinic's clock.
  month date not null check (extract(day from month) = 1),
  replies integer not null,
  blocks integer not null check (blocks > 0),
  amount_cents integer not null,
  stripe_invoice_id text,
  created_at timestamptz not null default now(),
  primary key (account_id, month)
);

alter table receptionist_overage_charges enable row level security;
-- Members see what they were charged and why; only the service role writes.
create policy "staff read receptionist_overage_charges" on receptionist_overage_charges
  for select using (is_account_member(account_id));
select public.require_two_factor_on('public.receptionist_overage_charges');

-- Every account's reply count for one month, on the clinic's clock, for the
-- accounts with any. For the cron, which runs as the service role.
create or replace function public.receptionist_replies_in_month(p_month date)
returns table (account_id uuid, replies integer)
language sql
stable
set search_path to 'public'
as $$
  select r.account_id, count(*)::integer
  from receptionist_replies r
  where r.created_at >= (date_trunc('month', p_month)::timestamp at time zone 'Europe/Madrid')
    and r.created_at < ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Europe/Madrid')
  group by r.account_id;
$$;
revoke execute on function public.receptionist_replies_in_month(date) from public, anon, authenticated;
grant execute on function public.receptionist_replies_in_month(date) to service_role;
