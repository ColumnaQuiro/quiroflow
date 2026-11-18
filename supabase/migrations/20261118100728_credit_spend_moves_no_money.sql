-- Spending account credit took the same euros off the balance twice.
--
-- Spending credit writes two rows: a payment of method 'credit', which
-- settles the receipt, and a negative account_credits row, which takes the
-- credit off what the patient can still spend. When 20260916160000 taught a
-- credit row to name the payment it restates, the two were meant to cancel in
-- the balance: the credit payment counted as +X, the spend row as -X.
-- 20260924095218 then (rightly) stopped counting a 'credit' payment as money,
-- and the -X was left with nothing to cancel against. Every spend of LEDGER
-- credit -- credit added through "Add credit", or a goodwill credit -- has
-- since read as debt of the same size: one patient paid 360 EUR, was charged
-- 360 EUR, owed nothing, and read -165 EUR.
--
-- The rule, the same one the patient's summary and Billing tab now apply
-- (utils/owing balanceCreditCentsOf):
--
--   balance = money in - charged + credit granted WITHOUT a payment
--
-- and spending credit moves nothing. So a spend row stays in the credit
-- LEDGER (what the patient can still direct, which it really does reduce) and
-- drops out of the BALANCE, exactly as the top-up row restating a payment
-- already does.
--
-- How a spend is recognised: by a flag written with it, not by pairing it to
-- its credit payment. Pairing was tried first and is wrong for the very first
-- patient above: two of their three spends belonged to receipts that were
-- later replaced by the same visits imported from PracticeHub, deleting the
-- QuiroFlow receipts and their credit payments with them. The credit really
-- was spent -- on the imported visits -- so the row has to keep counting in
-- the ledger and keep staying out of the balance with no payment left to
-- point at. A foreign key that cascaded would have handed that 110 EUR back
-- as spendable credit.
--
-- What is NOT a spend, and keeps counting in the balance: a transfer between
-- patients (AccountLedger's "Transfer credit" -- a -X on one patient and +X
-- on another, and the money really did move), goodwill credit, the
-- PracticeHub cutover and correction entries, and the old "Package session:"
-- drawdowns that 0161 retired, none of which has a credit payment.
alter table public.account_credits
  add column if not exists is_spend boolean not null default false;

comment on column public.account_credits.is_spend is
  'This negative row is credit being spent: the ledger side of a payment of method ''credit''. It reduces what the patient can still spend but never the balance, because the credit payment beside it moves no money and the credit it spends was counted once already, when it came in (as a payment, or as a goodwill row). Transfers between patients are not spends.';

-- Every row that is one today. "Applied to ..." is the reason every spending
-- path writes (BillingTab, utils/bonoSale, useVisitCharging, pages/billing/[id],
-- raise_invoice)
-- and nothing else does. On production on 18 Nov 2026 that was seven rows on
-- four patients, all seven beside a credit payment except the two whose
-- receipts were replaced by PracticeHub's, described above.
update public.account_credits
set is_spend = true
where amount_cents < 0
  and payment_id is null
  and reason like 'Applied to %'
  and coalesce(external_reference, '') not like 'bono-cutover-%'
  and not is_spend;

-- patient_live_balances, restated from 20260924095218 with the spend rows
-- left out of credit_cents. Every column stays, in order (create or replace
-- cannot drop or reorder them), and security_invoker is restated: replacing
-- the view without it once made it SECURITY DEFINER.
create or replace view public.patient_live_balances
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    (coalesce(pay.paid_cents, 0) - coalesce(inv.invoiced_cents, 0) + coalesce(cred.credit_cents, 0))::integer as balance_cents,
    least(
      coalesce(owed.unpaid_cents, 0),
      greatest(0, coalesce(owed.charged_cents, 0) - coalesce(pay.paid_cents, 0))
    )::integer as outstanding_cents
  from patients p
  left join lateral (
    select sum(i.total_cents) as invoiced_cents
    from invoices i
    where i.patient_id = p.id and i.status <> 'void'
  ) inv on true
  left join lateral (
    select sum(pay.amount_cents) as paid_cents
    from payments pay
    where pay.patient_id = p.id
      and pay.method <> 'credit'
  ) pay on true
  left join lateral (
    -- Credit granted without a payment. A row restating a payment (payment_id)
    -- is that payment, counted above; a spend row (is_spend) is credit moving,
    -- not money. The cutover entries count whatever they carry.
    select sum(c.amount_cents) as credit_cents
    from account_credits c
    where c.patient_id = p.id
      and (
        (c.payment_id is null and not c.is_spend)
        or coalesce(c.external_reference, '') like 'bono-cutover-%'
      )
  ) cred on true
  left join lateral (
    select
      sum(greatest(0, i.total_cents - coalesce(alloc.allocated_cents, 0)))
        filter (where i.status <> 'paid') as unpaid_cents,
      sum(i.total_cents) as charged_cents
    from invoices i
    left join lateral (
      select sum(pp.amount_cents) as allocated_cents
      from payments pp
      where pp.invoice_id = i.id
    ) alloc on true
    where i.patient_id = p.id
      and i.status <> 'void'
      and coalesce(i.is_refund, false) = false
  ) owed on true;

revoke all on public.patient_live_balances from anon;

-- patient_ledger, restated from 20261116194735 with is_spend added to the
-- credit rows, so usePatientFinancialSummary can leave spends out of the
-- balance the way the view above does. Nothing else changes.
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
        select id, amount_cents, reason, method, invoice_id, payment_id, created_at, external_reference, is_spend
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

-- raise_invoice, restated from 20261107121939. "Collect payment now" with
-- "Credit on account" wrote the negative row for the whole amount, whatever
-- the credit ledger held -- so spending money paid ahead (which has no ledger
-- row; utils/owing spendableCreditOf) drove the ledger below zero. Now it
-- draws only what the ledger holds, as every screen does through
-- utils/owing ledgerDrawCents, and marks the row a spend so the balance
-- leaves it out. The panel offers the option only up to the patient's
-- spendable credit; this function does not re-derive that (it needs the bonos'
-- committed value), only refuses to take the ledger below zero.
create or replace function public.raise_invoice(
  p_patient_id uuid,
  p_description text,
  p_amount_cents integer,
  p_appointment_id uuid default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_account uuid;
  v_number text;
  v_invoice uuid := gen_random_uuid();
  v_payment uuid;
  v_member uuid;
  v_ledger integer;
  v_draw integer;
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'The amount must be more than zero' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'The receipt needs a description' using errcode = 'check_violation';
  end if;
  if p_payment_method is not null and btrim(p_payment_method) = '' then
    raise exception 'Choose how it is paid' using errcode = 'check_violation';
  end if;

  select account_id into v_account from patients where id = p_patient_id;
  if v_account is null then
    raise exception 'Patient not found' using errcode = 'no_data_found';
  end if;
  if p_appointment_id is not null
     and not exists (select 1 from appointments where id = p_appointment_id and patient_id = p_patient_id and account_id = v_account) then
    raise exception 'That appointment is not this patient''s' using errcode = 'no_data_found';
  end if;

  v_number := next_invoice_number(v_account);

  insert into invoices (id, account_id, patient_id, appointment_id, invoice_number, status, total_cents)
  values (v_invoice, v_account, p_patient_id, p_appointment_id, v_number,
          case when p_payment_method is null then 'unpaid' else 'paid' end, p_amount_cents);

  insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
  values (v_account, v_invoice, btrim(p_description), 1, p_amount_cents);

  if p_payment_method is not null then
    v_member := current_team_member_id(v_account);
    v_payment := gen_random_uuid();
    insert into payments (id, account_id, patient_id, invoice_id, amount_cents, method, purpose, created_by)
    values (v_payment, v_account, p_patient_id, v_invoice, p_amount_cents, p_payment_method,
            case when p_payment_method = 'credit' then null else 'visit' end, v_member);

    -- The ledger part of the spend, and only that: the credit ledger is
    -- every row but the cutover entries (usePatientFinancialSummary's
    -- creditLedgerCents). The rest was paid ahead and has no row to take off.
    if p_payment_method = 'credit' then
      select coalesce(sum(amount_cents), 0) into v_ledger
      from account_credits
      where patient_id = p_patient_id
        and coalesce(external_reference, '') not like 'bono-cutover-%';
      v_draw := greatest(0, least(p_amount_cents, v_ledger));
      if v_draw > 0 then
        insert into account_credits (account_id, patient_id, amount_cents, reason, invoice_id, created_by, is_spend)
        values (v_account, p_patient_id, -v_draw, 'Applied to invoice ' || v_number, v_invoice, v_member, true);
      end if;
    end if;
  end if;

  return jsonb_build_object('invoice_id', v_invoice, 'invoice_number', v_number, 'payment_id', v_payment);
end;
$$;
revoke all on function public.raise_invoice(uuid, text, integer, uuid, text) from public, anon;
grant execute on function public.raise_invoice(uuid, text, integer, uuid, text) to authenticated, service_role;
