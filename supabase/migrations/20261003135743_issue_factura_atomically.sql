-- A factura's number and the factura itself, in one transaction.
--
-- Every issuer -- useFacturas() at the desk and in the app, issueFacturaServer()
-- for Stripe -- took a number with next_factura_number() and then inserted the
-- factura as a second request. The sequence row is committed by the first
-- request, so when the insert failed (the one-factura-per-payment index, a
-- check constraint, a policy, a dropped connection) the number was spent with
-- nothing carrying it: a gap in a correlative VeriFactu series, which is the
-- one thing the series exists to rule out. The callers then returned null and
-- nobody was told.
--
-- issue_factura() does both in one call, so a refused insert rolls the
-- sequence back with it and the number is handed out again. The series is
-- chosen from the kind -- R for a rectificativa, F for everything else -- the
-- same split the callers made by hand.
--
-- SECURITY INVOKER on purpose. The insert runs as the caller, under exactly
-- the policies ("staff write facturas", two-factor) and triggers
-- (fill_factura_issuer, fill_factura_tax, record_factura_alta,
-- stamp_created_by) a direct insert ran under, so nothing about who may issue
-- a factura or what it records changes. Only the numbering is privileged, and
-- next_factura_number() already is, with its own payments_allocate check.
--
-- next_factura_number() stays exactly as it is: the code live today calls it,
-- and keeps working against this schema until the release that stops doing so.

create or replace function public.issue_factura(
  p_account_id uuid,
  p_patient_id uuid,
  p_payment_id uuid,
  p_kind text,
  p_description text,
  p_amount_cents integer,
  p_tax_base_cents integer,
  p_tax_rate_bp integer,
  p_tax_amount_cents integer,
  p_tax_exemption_code text default null,
  p_rectifies_factura_id uuid default null
)
returns table (id uuid, number text)
language plpgsql
security invoker
set search_path to 'public'
as $function$
-- The OUT columns are called id and number, like the table's: read every bare
-- name as the column.
#variable_conflict use_column
declare
  v_number text;
begin
  v_number := next_factura_number(
    p_account_id,
    case when p_kind = 'rectificativa' then 'R' else 'F' end
  );

  return query
  insert into facturas as f (
    account_id, patient_id, payment_id, number, kind, description, amount_cents,
    tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code,
    rectifies_factura_id
  ) values (
    p_account_id, p_patient_id, p_payment_id, v_number, p_kind, p_description, p_amount_cents,
    p_tax_base_cents, p_tax_rate_bp, p_tax_amount_cents, p_tax_exemption_code,
    p_rectifies_factura_id
  )
  returning f.id, f.number;
end;
$function$;

comment on function public.issue_factura(uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, uuid) is
  'Numbers and inserts a factura in one transaction, so a refused insert does not spend a number. Runs as the caller: RLS and the facturas triggers apply as for a direct insert.';

revoke all on function public.issue_factura(uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, uuid) from public, anon;
grant execute on function public.issue_factura(uuid, uuid, uuid, text, text, integer, integer, integer, integer, text, uuid) to authenticated, service_role;
