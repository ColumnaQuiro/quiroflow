-- The dashboard's small widgets, counted in the database.
--
-- Each of these showed one to three numbers and fetched whole tables to get
-- them. Active patients paged through every completed appointment of the last
-- ninety days to count the distinct patients in it -- 9,000 rows in a busy
-- clinic, for one integer. Recalls due and Care-plan alerts read every row of
-- their view for a count and an average. Memberships read every membership
-- with its whole payment history, unpaged, so past 1,000 memberships the rest
-- were silently not there. Debtors read every bono, every payment linked to
-- one or to its sale invoice, and every Stripe schedule, to show five names.
--
-- Here instead, one row back per widget. The arithmetic is the widgets' own,
-- moved rather than rethought, and the filters are exactly the ones they sent:
-- the figures on screen do not move.
--
-- All security invoker (the default), so every table and view is read under
-- the same RLS the widget's own selects were -- the same rows, just not sent.
--
-- Anything relative to "now" is passed in rather than taken from now() here,
-- because the widgets work out those boundaries in the browser and a server
-- clock in another timezone would shift them.

-- Active patients: distinct patients with a completed appointment since
-- p_since. The widget computes p_since in the browser (today minus ninety
-- days, local time) and passes the same instant it used to filter by. No
-- deleted_at condition, because the widget's select had none.
create or replace function public.dashboard_active_patient_count(p_since timestamptz, p_practitioner_id uuid default null)
returns integer
language sql
stable
set search_path = public
as $$
  select count(distinct a.patient_id)::integer
  from appointments a
  where a.status = 'completed'
    and a.starts_at >= p_since
    and (p_practitioner_id is null or a.practitioner_id = p_practitioner_id)
$$;

-- Recalls due and Care-plan alerts: how many rows, and the sum and count of
-- the known day figures. The average is left to the widget (Math.round of
-- sum / known), so a half-day rounds exactly the way it always did --
-- Postgres's round() takes a negative half away from zero, JavaScript's
-- towards it.
create or replace function public.dashboard_recall_summary(p_practitioner_id uuid default null)
returns table (patient_count integer, days_known integer, days_sum bigint)
language sql
stable
set search_path = public
as $$
  select count(*)::integer,
         count(r.days_since_last_appointment)::integer,
         coalesce(sum(r.days_since_last_appointment), 0)::bigint
  from recall_candidates r
  where p_practitioner_id is null or r.default_practitioner_id = p_practitioner_id
$$;

create or replace function public.dashboard_continuity_summary(p_practitioner_id uuid default null)
returns table (patient_count integer, days_known integer, days_sum bigint)
language sql
stable
set search_path = public
as $$
  select count(*)::integer,
         count(c.days_overdue)::integer,
         coalesce(sum(c.days_overdue), 0)::bigint
  from care_plan_continuity_alerts c
  where p_practitioner_id is null or c.default_practitioner_id = p_practitioner_id
$$;

-- Memberships: active count, revenue for one month and failed payments.
--
-- A membership's payments are its membership_payments plus the charges on its
-- Stripe schedule (stripe_payment_events through payment_schedules), which is
-- what the widget merged. p_month is the 'YYYY-MM' key the widget compares
-- period_start's first seven characters against, computed in the browser from
-- the UTC date; period_start is a date, so to_char gives the same seven
-- characters. Failed payments are counted across all time, as before.
create or replace function public.dashboard_membership_summary(p_month text)
returns table (active_count integer, revenue_cents bigint, failed_count integer)
language sql
stable
set search_path = public
as $$
  with memberships as (
    select m.id, m.status from patient_memberships m
  ),
  charges as (
    select mp.status, mp.period_start, mp.amount_cents
    from membership_payments mp
    join memberships m on m.id = mp.patient_membership_id
    union all
    select e.status, e.period_start, e.amount_cents
    from payment_schedules s
    join memberships m on m.id = s.patient_membership_id
    join stripe_payment_events e on e.payment_schedule_id = s.id
  )
  select (select count(*) from memberships where status = 'active')::integer,
         (select coalesce(sum(amount_cents), 0) from charges
           where status = 'paid' and to_char(period_start, 'YYYY-MM') = p_month)::bigint,
         (select count(*) from charges where status = 'failed')::integer
$$;

-- Debtors: every bono still owed money, largest first, with the patient's
-- name for the first p_limit (null for all), and the count and total across
-- all of them on every row.
--
-- The owed figure is utils/bonoOwed.ts's bonoOwedCents, clause for clause --
-- read that file's comment for why a migrated bono and one sold here record
-- their debt differently:
--
--  - A payment counts towards a bono when it is linked to it, or when it
--    sits on the bono's sale invoice and that invoice is visible and not
--    void. Never when its purpose is 'on_account'. Each payment once, even
--    when it is both (the widget merged them by id).
--  - owed_cents set: owed_cents less what was paid on THIS side (anything
--    whose external_reference does not start 'phpay-'), floored at zero.
--  - Otherwise, no valid invoice and no counted payment at all: nothing owed.
--  - Otherwise what was invoiced (or, with no valid invoice, the price) less
--    everything paid, floored at zero.
--
-- A bono with a Stripe schedule is only a debtor while that schedule is
-- past_due; the widget kept one schedule per bono, and where a bono has more
-- than one this takes the newest. Ties sort by id, the order the widget
-- received the bonos in before its stable sort.
create or replace function public.dashboard_bono_debtors(p_limit integer default null)
returns table (
  package_purchase_id uuid,
  first_name text,
  last_name text,
  owed_cents integer,
  debtor_count integer,
  total_owed_cents bigint
)
language sql
stable
set search_path = public
as $$
  with purchases as (
    select pp.id,
           pp.patient_id,
           pp.invoice_id,
           pp.price_cents,
           pp.owed_cents,
           inv.total_cents as invoice_total_cents,
           (inv.id is not null and inv.status <> 'void') as invoice_is_valid
    from package_purchases pp
    left join invoices inv on inv.id = pp.invoice_id
  ),
  owed as (
    select pu.id,
           pu.patient_id,
           case
             when pu.owed_cents is not null then greatest(0, pu.owed_cents - paid.here_cents)
             when not pu.invoice_is_valid and paid.n = 0 then 0
             else greatest(0, (case when pu.invoice_is_valid then pu.invoice_total_cents else pu.price_cents end) - paid.all_cents)
           end as owed_cents,
           sched.status as schedule_status
    from purchases pu
    cross join lateral (
      select count(*) as n,
             coalesce(sum(p.amount_cents), 0) as all_cents,
             coalesce(sum(p.amount_cents) filter (where p.external_reference is null or p.external_reference not like 'phpay-%'), 0) as here_cents
      from payments p
      where p.purpose is distinct from 'on_account'
        and (p.package_purchase_id = pu.id or (pu.invoice_is_valid and p.invoice_id = pu.invoice_id))
    ) paid
    left join lateral (
      select s.status
      from payment_schedules s
      where s.package_purchase_id = pu.id
      order by s.created_at desc, s.id desc
      limit 1
    ) sched on true
  ),
  debtors as (
    select o.id, o.patient_id, o.owed_cents
    from owed o
    where o.owed_cents > 0 and (o.schedule_status is null or o.schedule_status = 'past_due')
  )
  select d.id,
         pt.first_name,
         pt.last_name,
         d.owed_cents::integer,
         (count(*) over ())::integer,
         (sum(d.owed_cents) over ())::bigint
  from debtors d
  left join patients pt on pt.id = d.patient_id
  order by d.owed_cents desc, d.id
  limit p_limit
$$;

revoke all on function public.dashboard_active_patient_count(timestamptz, uuid) from anon, public;
revoke all on function public.dashboard_recall_summary(uuid) from anon, public;
revoke all on function public.dashboard_continuity_summary(uuid) from anon, public;
revoke all on function public.dashboard_membership_summary(text) from anon, public;
revoke all on function public.dashboard_bono_debtors(integer) from anon, public;
grant execute on function public.dashboard_active_patient_count(timestamptz, uuid) to authenticated, service_role;
grant execute on function public.dashboard_recall_summary(uuid) to authenticated, service_role;
grant execute on function public.dashboard_continuity_summary(uuid) to authenticated, service_role;
grant execute on function public.dashboard_membership_summary(text) to authenticated, service_role;
grant execute on function public.dashboard_bono_debtors(integer) to authenticated, service_role;
