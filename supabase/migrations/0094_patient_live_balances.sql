-- Live-computed patient balance (paid − invoiced + account credit), matching
-- usePatientFinancialSummary.ts's formula exactly. `patients.balance_cents`
-- is a raw stored column only ever written once at PracticeHub import time
-- and never kept in sync afterward -- every UI surface that read it directly
-- (patients list, calendar balance icons, recall_candidates) was silently
-- showing a stale number for any patient with real invoice/payment/credit
-- activity since import. security_invoker so RLS on the underlying tables
-- (not this view's owner) governs visibility, matching recall_candidates below.
create view patient_live_balances
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    -- sum() promotes to bigint; cast back to integer (matching patients.balance_cents'
    -- original type) so `recall_candidates` below can keep its existing column type.
    (coalesce(pay.paid_cents, 0) - coalesce(inv.invoiced_cents, 0) + coalesce(cred.credit_cents, 0))::integer as balance_cents
  from patients p
  left join lateral (
    select sum(i.total_cents) as invoiced_cents
    from invoices i
    where i.patient_id = p.id and i.status <> 'void'
  ) inv on true
  left join lateral (
    select sum(pay.amount_cents) as paid_cents
    from payments pay
    join invoices i on i.id = pay.invoice_id
    where i.patient_id = p.id and i.status <> 'void'
  ) pay on true
  left join lateral (
    select sum(amount_cents) as credit_cents
    from account_credits
    where patient_id = p.id
  ) cred on true;

-- Recall candidates inherited the same stale-balance bug via p.balance_cents
-- -- swap in the live view so the recall queue's balance column/filter match
-- reality without touching pages/recalls.vue at all.
create or replace view recall_candidates
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    p.first_name,
    p.last_name,
    p.email,
    p.tags,
    lb.balance_cents,
    p.recall_priority,
    p.default_practitioner_id,
    la.last_appointment_at,
    (current_date - la.last_appointment_at::date) as days_since_last_appointment,
    p.preferred_language
  from patients p
  join lateral (
    select max(a.starts_at) as last_appointment_at
    from appointments a
    where a.patient_id = p.id and a.status <> 'cancelled'
  ) la on true
  left join patient_live_balances lb on lb.patient_id = p.id
  where la.last_appointment_at is not null
    and p.recall_status = 'active'
    and not p.do_not_contact
    and not p.is_minor
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.starts_at > now()
    );
