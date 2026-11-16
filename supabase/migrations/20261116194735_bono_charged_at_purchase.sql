-- A bono whose whole price was charged when it was sold, so a session drawn
-- from it is already paid for and charges nothing more.
--
-- QuiroFlow sells a bono with no invoice: the money sits in the balance and
-- each visit is charged at the bono's per-session rate, which is what draws it
-- down (useVisitCharging, utils/bonoVisitInvoice). Columnaquiro, Castellón
-- and QuiroBalance kept their bonos the same way in PracticeHub -- every
-- package there has free_visits = 0, one charge per visit.
--
-- Elevate Chiropractic does not. 310 of its 332 PracticeHub packages carry
-- free_visits = visits - 1: the full price is invoiced on the visit the bono
-- is bought at, and every visit after it is invoiced at 0. Imported, that is
-- an 800 EUR paid invoice for a Bono 20 and 0 EUR invoices for its sessions --
-- the bono's money already spent by its own invoice. The first session logged
-- in QuiroFlow then charged 40 EUR on top, unpaid, against a balance that had
-- nothing left in it for the bono: a patient in credit by 10 EUR in
-- PracticeHub read as owing 30 on 16 Nov 2026.
--
-- The importer sets this from PracticeHub (utils/practiceHubBono), and
-- chargeBonoVisit reads it from the row, so the calendar, the Money tab and
-- the staff app all charge such a session at 0 and mark it paid. A bono sold
-- in QuiroFlow keeps the default and is charged exactly as before.
alter table public.package_purchases
  add column if not exists charged_at_purchase boolean not null default false;

comment on column public.package_purchases.charged_at_purchase is
  'The bono''s whole price was invoiced when it was sold (PracticeHub free_visits), so its sessions are charged at 0. False: each session is charged at price / sessions_total.';

-- patient_ledger, restated from 20261111192200 with charged_at_purchase added
-- to both bono lists, so the buttons that use a session can say it is already
-- paid instead of quoting a rate nobody will be charged. Nothing else changes.
create or replace function public.patient_ledger(p_patient_id uuid, p_detail boolean default false)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (
        select id, invoice_number, status, total_cents, created_at, is_refund, refunds_invoice_id, refunds_payment_id
        from invoices
        where patient_id = p_patient_id
      ) i
    ), '[]'::jsonb),
    -- By patient, not through their invoices: money on account has no
    -- invoice. team_members is who recorded it, as the embed returned it.
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p)) from (
        select pay.id, pay.invoice_id, pay.amount_cents, pay.method, pay.paid_at, pay.package_purchase_id,
               pay.external_reference, pay.purpose, pay.created_by, pay.stripe_payment_intent_id,
               (select jsonb_build_object('full_name', tm.full_name) from team_members tm where tm.id = pay.created_by) as team_members
        from payments pay
        where pay.patient_id = p_patient_id
      ) p
    ), '[]'::jsonb),
    'account_credits', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at) from (
        select id, amount_cents, reason, method, invoice_id, payment_id, created_at, external_reference
        from account_credits
        where patient_id = p_patient_id
      ) c
    ), '[]'::jsonb),
    -- Unordered, as the summary's own select was: it shows the first.
    'active_memberships', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, membership_name, status
        from patient_memberships
        where patient_id = p_patient_id and status = 'active'
      ) m
    ), '[]'::jsonb),
    -- Each bono with every payment linked to it, whoever's record it was
    -- taken on (utils/bonoOwed, BONO_PAYMENTS_EMBED).
    'package_purchases', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.purchased_at desc) from (
        select pp.id, pp.package_name, pp.sessions_total, pp.sessions_used, pp.price_cents, pp.purchased_at,
               pp.invoice_id, pp.owed_cents, pp.installments, pp.installment_cents, pp.is_closed, pp.charged_at_purchase,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', bp.id,
                   'invoice_id', bp.invoice_id,
                   'amount_cents', bp.amount_cents,
                   'method', bp.method,
                   'paid_at', bp.paid_at,
                   'package_purchase_id', bp.package_purchase_id,
                   'external_reference', bp.external_reference,
                   'purpose', bp.purpose,
                   'patient_id', bp.patient_id,
                   'patients', (select jsonb_build_object('first_name', payer.first_name, 'last_name', payer.last_name) from patients payer where payer.id = bp.patient_id)
                 ))
                 from payments bp
                 where bp.package_purchase_id = pp.id
               ), '[]'::jsonb) as payments
        from package_purchases pp
        where pp.patient_id = p_patient_id
      ) b
    ), '[]'::jsonb),
    -- Bonos shared TO this patient, read through the shares table as staff
    -- read them. Null where the bono itself is not the caller's to see.
    'package_shares', coalesce((
      select jsonb_agg(to_jsonb(s)) from (
        select (
          select jsonb_build_object(
            'id', pp.id,
            'package_name', pp.package_name,
            'sessions_total', pp.sessions_total,
            'sessions_used', pp.sessions_used,
            'price_cents', pp.price_cents,
            'purchased_at', pp.purchased_at,
            'invoice_id', pp.invoice_id,
            'owed_cents', pp.owed_cents,
            'installments', pp.installments,
            'installment_cents', pp.installment_cents,
            'is_closed', pp.is_closed,
            'charged_at_purchase', pp.charged_at_purchase,
            'patients', (select jsonb_build_object('first_name', o.first_name, 'last_name', o.last_name) from patients o where o.id = pp.patient_id)
          )
          from package_purchases pp
          where pp.id = sh.package_purchase_id
        ) as package_purchases
        from package_purchase_shares sh
        where sh.patient_id = p_patient_id
      ) s
    ), '[]'::jsonb),
    -- A patient cannot read the shares table (it has only a staff policy), so
    -- when it shows them nothing get_my_shared_packages answers instead, as
    -- it did in a second request. Null when the table did answer.
    'my_shared_packages', case
      when not exists (select 1 from package_purchase_shares sh where sh.patient_id = p_patient_id)
      then coalesce((select jsonb_agg(to_jsonb(g)) from get_my_shared_packages(p_patient_id) g), '[]'::jsonb)
    end,

    -- From here down: the Billing tab's own cards.
    'line_items', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(l)) from (
        select li.invoice_id, li.description
        from invoice_line_items li
        join invoices i on i.id = li.invoice_id
        where i.patient_id = p_patient_id
      ) l
    ), '[]'::jsonb) end,
    'package_sessions', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(s) order by s.used_at) from (
        select ps.id, ps.amount_cents, ps.used_at,
               (select jsonb_build_object('package_name', pp.package_name) from package_purchases pp where pp.id = ps.package_purchase_id) as package_purchases
        from package_sessions ps
        where ps.patient_id = p_patient_id
      ) s
    ), '[]'::jsonb) end,
    'payment_schedules', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(s)) from (
        select id, package_purchase_id, patient_membership_id, "interval", interval_count, installments_total, installments_paid, status
        from payment_schedules
        where patient_id = p_patient_id
      ) s
    ), '[]'::jsonb) end,
    'stripe_payment_events', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(e) order by e.period_start desc) from (
        select id, payment_schedule_id, period_start, amount_cents, status
        from stripe_payment_events
        where payment_schedule_id in (select id from payment_schedules where patient_id = p_patient_id)
      ) e
    ), '[]'::jsonb) end,
    'memberships', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(m) order by m.started_at desc) from (
        select pm.id, pm.membership_name, pm.price_cents, pm.status, pm.started_at, pm.billing_interval, pm.billing_interval_count,
               (select jsonb_build_object('billing_interval', pl.billing_interval, 'billing_interval_count', pl.billing_interval_count) from memberships pl where pl.id = pm.membership_id) as memberships
        from patient_memberships pm
        where pm.patient_id = p_patient_id
      ) m
    ), '[]'::jsonb) end,
    'membership_payments', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(mp) order by mp.period_start desc) from (
        select pay.id, pay.patient_membership_id, pay.period_start, pay.amount_cents, pay.status
        from membership_payments pay
        join patient_memberships pm on pm.id = pay.patient_membership_id
        where pm.patient_id = p_patient_id
      ) mp
    ), '[]'::jsonb) end,
    -- An array, not the one row: the old read was a maybeSingle(), which
    -- answers null for two rows, and a scalar subquery would raise instead
    -- and take the whole ledger with it.
    'stripe_customers', case when p_detail then coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select stripe_customer_id, default_payment_method_id
        from patient_stripe_customers
        where patient_id = p_patient_id
      ) c
    ), '[]'::jsonb) end
  );
$function$;

revoke all on function public.patient_ledger(uuid, boolean) from public, anon;
grant execute on function public.patient_ledger(uuid, boolean) to authenticated, service_role;
