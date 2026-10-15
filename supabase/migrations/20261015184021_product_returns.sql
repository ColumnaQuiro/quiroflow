-- Products returned to the shelf (follow-up to 20261015155217_products_and_stock.sql).
--
-- A product sale can be refunded like any receipt (the Money tab's Refund),
-- which corrects the money and issues the rectificativa at the product's IVA.
-- What it did not do is put the units back: a pillow brought back unopened
-- stayed sold as far as the stock knew. Now the refund offers "back to
-- stock", and return_product_stock() adds them with a 'return' movement.
--
-- A return is tied to the SALE's invoice (product_stock_movements.invoice_id,
-- as the sale's own movement is), so what can still come back is simply
-- what that invoice sold less what has already been returned against it --
-- a second refund of the same receipt cannot put the same unit back twice.

alter table public.product_stock_movements drop constraint product_stock_movements_kind_check;
alter table public.product_stock_movements add constraint product_stock_movements_kind_check
  check (kind in ('receive', 'sale', 'adjust', 'return'));

-- p_items: [{ "product_id": uuid, "units": int }, ...]
create or replace function public.return_product_stock(p_invoice_id uuid, p_items jsonb, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invoice invoices;
  v_member uuid;
  v_returned integer := 0;
  r record;
  v_returnable integer;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_invoice from invoices where id = p_invoice_id;
  if v_invoice.id is null or v_invoice.is_refund then
    raise exception 'No such sale' using errcode = '22023';
  end if;
  if not public.is_account_member(v_invoice.account_id)
     or not public.has_permission(v_invoice.account_id, 'billing_access')
     or not public.can_access_patient(v_invoice.account_id, v_invoice.patient_id) then
    raise exception 'Your role cannot take returns for this patient' using errcode = '42501';
  end if;
  select tm.id into v_member from team_members tm
  where tm.account_id = v_invoice.account_id and tm.user_id = auth.uid() and tm.deleted_at is null;

  perform set_config('quiroflow.stock_write', 'on', true);
  for r in
    select (i->>'product_id')::uuid as product_id, sum((i->>'units')::integer)::integer as units
    from jsonb_array_elements(p_items) i
    group by 1
  loop
    continue when coalesce(r.units, 0) <= 0;
    perform 1 from services_products where id = r.product_id and account_id = v_invoice.account_id for update;
    -- Sold on this receipt, less what already came back against it.
    select coalesce(-sum(delta) filter (where kind = 'sale'), 0) - coalesce(sum(delta) filter (where kind = 'return'), 0)
      into v_returnable
    from product_stock_movements
    where invoice_id = p_invoice_id and product_id = r.product_id;
    if r.units > v_returnable then
      raise exception 'Only % can come back from this sale', v_returnable using errcode = '22023';
    end if;
    update services_products set stock_units = stock_units + r.units where id = r.product_id and stock_units is not null;
    insert into product_stock_movements (account_id, product_id, delta, kind, reason, invoice_id, created_by)
    values (v_invoice.account_id, r.product_id, r.units, 'return', nullif(btrim(coalesce(p_reason, '')), ''), p_invoice_id, v_member);
    v_returned := v_returned + r.units;
  end loop;
  perform set_config('quiroflow.stock_write', 'off', true);
  return v_returned;
end;
$$;
revoke all on function public.return_product_stock(uuid, jsonb, text) from public, anon;
grant execute on function public.return_product_stock(uuid, jsonb, text) to authenticated;
