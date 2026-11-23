-- A special price on a visit: seniors, students, disability.
--
-- A clinic asked where to charge a visita suelta at its reduced rate instead
-- of the normal 45 EUR. There was nowhere: the appointment's Cobro tab could
-- take a line off or add a service, and every price came from the
-- appointment type. So the receptionist either charged 45 and refunded the
-- difference, or removed the visit and added some made-up service at the
-- other price -- and the receipt then said nothing about why.
--
-- The line keeps what it would have cost and why it does not:
--
--   list_price_cents     the price before it was changed. Null on a line
--                        whose price was never changed, which is every line
--                        written before this.
--   price_change_reason  "Mayores", "Estudiante", "Discapacidad" or the
--                        clinic's own words.
--
-- and its description says so, the way charge_visit_to_third_party already
-- writes " · copago <insurer>" onto the same line: "Visita suelta · precio
-- especial: Estudiante". The description is what the receipt, the PDF, the
-- patient's ledger and the app all print, so none of them needs to learn a
-- new column to show it.
--
-- Only on a receipt nobody has paid anything against. VeriFactu: a factura is
-- issued per PAYMENT (0172_facturas_follow_the_payment), never per receipt,
-- and it carries its own description and amount -- nothing on
-- invoice_line_items is hashed into factura_huella_input. So a receipt with
-- no payments has no factura, and changing its lines cannot touch one. A
-- receipt with any payment -- part paid, paid, credit spent on it -- may
-- have a factura in someone's hands for that money, and its price is closed.
-- The check runs here, under a lock on the receipt, so a payment taken from
-- another screen between the click and the save is seen.
--
-- SECURITY INVOKER, like charge_visit_to_third_party: the caller's RLS applies
-- to every row it touches (invoice_line_items' write policy is the
-- financials_edit_* check), and on top of that it asks for billing_access --
-- "Cobrar y hacer recibos", the permission the Cobro tab's own controls are
-- gated on.
--
-- Nothing else changes. No new table (so no two-factor line), no patient_id
-- (so merge_patients and anonymize_patient are untouched). invoice_line_items
-- is deliberately not audited (20261008070424_audit_trail); the receipt's
-- total is, and moves with this.

alter table public.invoice_line_items
  add column list_price_cents integer,
  add column price_change_reason text;

alter table public.invoice_line_items
  add constraint invoice_line_items_price_change_reason_length
    check (price_change_reason is null or char_length(price_change_reason) between 1 and 80);

comment on column public.invoice_line_items.list_price_cents is
  'The price this line had before someone gave it a special price (change_invoice_line_price). Null when the price was never changed.';
comment on column public.invoice_line_items.price_change_reason is
  'Why the price was changed: Mayores, Estudiante, Discapacidad or free text. Also appended to the description as " · precio especial: <reason>".';

create or replace function public.change_invoice_line_price(
  p_line_id uuid,
  p_price_cents integer,
  p_reason text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_line invoice_line_items%rowtype;
  v_invoice invoices%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_list integer;
  v_base text;
  v_old_suffix text;
  v_revert boolean;
  v_total integer;
  v_rows int;
begin
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'The price cannot be negative' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_line from invoice_line_items where id = p_line_id;
  if v_line.id is null then
    raise exception 'Line not found' using errcode = 'no_data_found';
  end if;

  -- Locked, so a payment recorded from another screen cannot land between
  -- the checks below and the update. FOR UPDATE also applies the invoices
  -- UPDATE policy (financials_edit_*), so a receipt the caller can read --
  -- they found its line -- but may not edit comes back as nothing here.
  select * into v_invoice from invoices where id = v_line.invoice_id for update;
  if v_invoice.id is null then
    raise exception 'Your role cannot change this receipt' using errcode = 'insufficient_privilege';
  end if;

  if not has_permission(v_invoice.account_id, 'billing_access') then
    raise exception 'Your role cannot change prices on receipts' using errcode = 'insufficient_privilege';
  end if;

  -- Open means: not void, not a refund, nothing paid against it. A 0 EUR
  -- receipt is raised 'paid' with no payment (a free visit,
  -- utils/visitCharging newVisitReceiptStatus) and is still open in the same
  -- sense visitReceiptEditable treats it.
  if v_invoice.status = 'void' or coalesce(v_invoice.is_refund, false)
     or (v_invoice.status = 'paid' and v_invoice.total_cents <> 0) then
    raise exception 'This receipt is closed: its price can no longer be changed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from payments where invoice_id = v_invoice.id) then
    raise exception 'This receipt already has payments against it: its price can no longer be changed' using errcode = 'check_violation';
  end if;
  -- A bono session is charged at the bono's rate, and a visit split with an
  -- insurer has its patient share fixed by that split
  -- (third_party_charges.list_price_cents restores it). Neither is a price to
  -- set by hand.
  if v_line.package_purchase_id is not null
     or (v_invoice.appointment_id is not null
         and exists (select 1 from package_sessions where appointment_id = v_invoice.appointment_id)) then
    raise exception 'A visit taken from a bono is charged at the bono''s rate' using errcode = 'check_violation';
  end if;
  if exists (select 1 from third_party_charges where invoice_id = v_invoice.id and status = 'pending') then
    raise exception 'This visit is charged to a third party: change the split instead' using errcode = 'check_violation';
  end if;

  v_list := coalesce(v_line.list_price_cents, v_line.price_cents * v_line.quantity);
  v_revert := v_line.list_price_cents is not null and p_price_cents = v_line.list_price_cents;
  if not v_revert and v_reason is null then
    raise exception 'Say why the price is different' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason is not null and char_length(v_reason) > 80 then
    raise exception 'The reason is too long' using errcode = 'invalid_parameter_value';
  end if;

  -- The description as it was before any special price, so changing the
  -- reason twice does not stack two suffixes.
  v_base := v_line.description;
  if v_line.price_change_reason is not null then
    v_old_suffix := ' · precio especial: ' || v_line.price_change_reason;
    if right(v_base, char_length(v_old_suffix)) = v_old_suffix then
      v_base := left(v_base, char_length(v_base) - char_length(v_old_suffix));
    end if;
  end if;

  if v_revert then
    update invoice_line_items
       set price_cents = v_line.list_price_cents,
           quantity = 1,
           description = v_base,
           list_price_cents = null,
           price_change_reason = null
     where id = v_line.id;
  else
    update invoice_line_items
       set price_cents = p_price_cents,
           quantity = 1,
           description = v_base || ' · precio especial: ' || v_reason,
           list_price_cents = v_list,
           price_change_reason = v_reason
     where id = v_line.id;
  end if;
  -- RLS filters an update it refuses rather than raising: the caller can see
  -- the line but may not edit this receipt (financials_edit_*).
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Your role cannot change this receipt' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(l.price_cents * l.quantity), 0)::int into v_total
    from invoice_line_items l where l.invoice_id = v_invoice.id;

  -- Nothing has been paid on it (checked above), so a priced receipt is owed
  -- -- a free visit's 0 EUR receipt, raised paid, is owed again once it has a
  -- price. One repriced DOWN to 0 EUR keeps its status: the Cobro tab settles
  -- it and completes the visit (useVisitCharging, as after a third party
  -- takes the whole visit), the same steps a free visit charged from scratch
  -- goes through.
  update invoices
     set total_cents = v_total,
         status = case when v_total > 0 then 'unpaid' else v_invoice.status end
   where id = v_invoice.id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Your role cannot change this receipt' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice.id,
    'total_cents', v_total,
    'status', case when v_total > 0 then 'unpaid' else v_invoice.status end
  );
end;
$$;

revoke all on function public.change_invoice_line_price(uuid, integer, text) from public, anon;
grant execute on function public.change_invoice_line_price(uuid, integer, text) to authenticated;
