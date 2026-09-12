-- Keys for the PracticeHub ledger import.
--
-- Neither invoices nor payments could say which PracticeHub record they came
-- from. The old importer encoded it in the invoice number ('PH-' || payment
-- id), which is why re-running it meant string-matching invoice numbers, and
-- why payments -- having no number of their own -- could not be de-duplicated
-- at all.
--
-- A real key on both tables makes the import idempotent (a second run inserts
-- nothing) and, just as importantly, makes it reversible: phase 5 can identify
-- exactly the rows the import created, as opposed to the ones it replaces.
--
-- Partial unique, matching the shape 0108 already uses for patients,
-- appointments, contact_log and patient_docs: null means "not from
-- PracticeHub" and any number of rows may say that.

alter table invoices add column external_reference text;
alter table payments add column external_reference text;

create unique index invoices_account_external_reference_uniq
  on invoices (account_id, external_reference)
  where external_reference is not null;

create unique index payments_account_external_reference_uniq
  on payments (account_id, external_reference)
  where external_reference is not null;

comment on column invoices.external_reference is
  'PracticeHub invoice id this row was imported from. Null for invoices raised in QuiroFlow.';
comment on column payments.external_reference is
  'PracticeHub payment id this row was imported from. Null for payments taken in QuiroFlow.';

-- ---------------------------------------------------------------------
-- Settling imported invoices
-- ---------------------------------------------------------------------
--
-- PracticeHub records no link between a payment and an invoice, so nothing
-- here may claim one. But an invoice still has to say something in its status
-- column, and marking 7,021 historical visits "unpaid" would be its own lie --
-- the patients paid, PracticeHub simply never said which visit each payment
-- was for.
--
-- So this settles invoices WITHOUT touching a single payment row. Per patient,
-- imported invoices are walked oldest-first against the total that patient has
-- paid; an invoice is 'paid' once the running total of what they were charged
-- up to and including it is covered by what they handed over. Nothing is
-- allocated, no payment gains an invoice_id, and no payment is split -- which
-- would have meant inventing payment rows PracticeHub never recorded.
--
-- The patient's balance is unaffected either way: it is paid minus invoiced,
-- and neither side moves here. Only what the status column says moves.
--
-- Confined to imported rows on purpose. Invoices raised in QuiroFlow are
-- settled by their own allocated payments and are none of this function's
-- business.
create or replace function settle_imported_invoices(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is not null and not has_permission(p_account_id, 'data_admin') then
    raise exception 'Not permitted';
  end if;

  with paid as (
    select patient_id, sum(amount_cents) as paid_cents
    from payments
    where account_id = p_account_id and external_reference like 'phpay-%'
    group by patient_id
  ),
  running as (
    select i.id,
           i.patient_id,
           sum(i.total_cents) over (
             partition by i.patient_id
             order by i.created_at, i.id
             rows between unbounded preceding and current row
           ) as cumulative_cents
    from invoices i
    where i.account_id = p_account_id and i.external_reference like 'phinv-%'
  ),
  decided as (
    select r.id,
           case when coalesce(p.paid_cents, 0) >= r.cumulative_cents then 'paid' else 'unpaid' end as status
    from running r
    left join paid p on p.patient_id = r.patient_id
  )
  update invoices i
  set status = d.status
  from decided d
  where i.id = d.id and i.status <> d.status and i.status <> 'void';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function settle_imported_invoices(uuid) from public;
grant execute on function settle_imported_invoices(uuid) to authenticated, service_role;
