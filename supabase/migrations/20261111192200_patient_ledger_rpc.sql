-- A patient's money in one request, and the Billing list's header in one.
--
-- Opening a patient's Billing tab fired about twenty-two requests, and so did
-- every payment recorded on it: the tab read invoices, payments, credits and
-- bonos for its own cards while usePatientFinancialSummary read the same four
-- tables again for the figures above them. The Billing list counted its four
-- chips with four requests and worked out what is outstanding from every
-- unpaid invoice and then its payments, 150 ids to a URL. On production's
-- two-core database requests fired together queue behind each other, so
-- twenty small ones cost far more than twenty.
--
-- These fold the TRANSPORT and nothing else. Each key holds the rows one of
-- the old selects returned -- same columns, same filters, same order -- and
-- every figure is still worked out by the TypeScript that worked it out
-- before (utils/owing, utils/bonoOwed, usePatientFinancialSummary). No
-- balance, credit or debt is derived here: the rules for those (a 'credit'
-- payment is not money, what a migrated bono owes, what a void invoice
-- leaves behind) live in one place and that place is not SQL.
--
-- Security invoker, so each table answers from the caller's own policies
-- exactly as it did to the separate selects: a role that could not see a
-- table's rows gets an empty key, not an error, and a patient reading their
-- own money through the app gets what their policies allowed before.
--
-- One difference worth knowing: PostgREST caps a select at 1,000 rows and a
-- jsonb_agg does not, so a patient with more than 1,000 payments now has all
-- of them counted where the old selects silently stopped at the cap.

-- p_detail is what the Billing tab adds to what every other screen needs.
-- The summary (patient header, calendar hover card, inbox panel, the patient
-- app) passes false and those subqueries are never run.
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
               pp.invoice_id, pp.owed_cents, pp.installments, pp.installment_cents, pp.is_closed,
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

-- The facturas a patient has been given, with the two things the list needs
-- beside them: the patient's own NIF and usual practitioner, and whoever a
-- tutor's factura is addressed to. Three requests, two of them in series.
create or replace function public.patient_facturas(p_patient_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'patient', (
      select jsonb_build_object('national_id', pt.national_id, 'default_practitioner_id', pt.default_practitioner_id)
      from patients pt
      where pt.id = p_patient_id
    ),
    'facturas', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.issued_at desc) from (
        select id, number, kind, description, amount_cents, issued_at, recipient_nif, recipient_patient_id,
               payment_id, rectifies_factura_id, annulled_at
        from facturas
        where patient_id = p_patient_id
      ) f
    ), '[]'::jsonb),
    'addressees', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select id, first_name, last_name, national_id
        from patients
        where id in (
          select recipient_patient_id from facturas
          where patient_id = p_patient_id and recipient_patient_id is not null
        )
      ) a
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.patient_facturas(uuid) from public, anon;
grant execute on function public.patient_facturas(uuid) to authenticated, service_role;

-- The Billing list's header: its four chips, and the rows "outstanding" is
-- summed from. The counts are plain counts under the list's own filters. The
-- outstanding figure is NOT computed here -- the page sums these rows with
-- the code it always used -- they just arrive in one response instead of a
-- page of invoices followed by their payments in chunks.
--
-- p_search_patient_ids is the set of patients the page's search already
-- resolved for the list beside it, passed in rather than worked out again so
-- the chips and the list cannot disagree about who matched. '*' is a
-- wildcard because it is one in the PostgREST filter the list uses.
create or replace function public.billing_invoice_stats(
  p_patient_id uuid default null,
  p_term text default '',
  p_search_patient_ids uuid[] default '{}'
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with scoped as materialized (
    select i.id, i.status, i.total_cents
    from invoices i
    where (p_patient_id is null or i.patient_id = p_patient_id)
      and (
        coalesce(p_term, '') = ''
        or i.invoice_number ilike '%' || replace(p_term, '*', '%') || '%'
        or i.patient_id = any (coalesce(p_search_patient_ids, '{}'))
      )
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'unpaid', count(*) filter (where status = 'unpaid'),
        'paid', count(*) filter (where status = 'paid'),
        'void', count(*) filter (where status = 'void')
      )
      from scoped
    ),
    'unpaid', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'total_cents', s.total_cents) order by s.id)
      from scoped s
      where s.status = 'unpaid'
    ), '[]'::jsonb),
    'unpaid_payments', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_id', pay.invoice_id, 'amount_cents', pay.amount_cents))
      from payments pay
      where pay.invoice_id in (select s.id from scoped s where s.status = 'unpaid')
    ), '[]'::jsonb),
    -- The patient the page is narrowed to, for its chip.
    'patient', (
      select jsonb_build_object('first_name', pt.first_name, 'last_name', pt.last_name)
      from patients pt
      where pt.id = p_patient_id
    )
  );
$function$;

revoke all on function public.billing_invoice_stats(uuid, text, uuid[]) from public, anon;
grant execute on function public.billing_invoice_stats(uuid, text, uuid[]) to authenticated, service_role;
