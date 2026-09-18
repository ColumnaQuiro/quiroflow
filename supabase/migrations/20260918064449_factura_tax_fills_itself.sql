-- A factura fills in its own tax when the caller does not.
--
-- 20260917180639 made tax_base_cents NOT NULL with no default, which created
-- an ordering trap between that migration and the release carrying the code
-- that populates it:
--
--   Apply the migration first, and the currently-deployed app -- which knows
--   nothing about these columns -- violates the constraint on every factura
--   insert. useFacturas() swallows errors by design, so that money is never
--   blocked, which means facturas would simply stop being issued and nothing
--   would say so.
--
--   Release first, and check:migrations-applied fails the deploy, because the
--   code expects columns the database does not have.
--
-- Neither order is safe, and "apply and release quickly" is not a fix -- it
-- just shrinks the window in which a patient pays and receives no document.
--
-- So the database fills the values itself when they arrive null. An insert
-- from the old code now works; an insert from the new code passes its own
-- figures and this leaves them alone. The migration and the release become
-- independent, which is what they should have been.
--
-- It is also the same argument the record chain already makes: facturas has
-- several insert paths, and a rule that only holds for the ones someone
-- remembered to update is not a rule. This one now holds for every path,
-- including any added later.

create or replace function fill_factura_tax()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rate integer;
  v_code text;
begin
  -- The caller said what the tax was; that wins. This only supplies a value
  -- where there is none.
  if new.tax_base_cents is not null then
    return new;
  end if;

  select a.factura_tax_rate_bp, a.factura_tax_exemption_code
  into v_rate, v_code
  from accounts a
  where a.id = new.account_id;

  v_rate := coalesce(v_rate, 0);
  if v_code is not null then
    v_rate := 0;
  end if;

  if v_rate <= 0 then
    new.tax_base_cents := new.amount_cents;
    new.tax_rate_bp := 0;
    new.tax_amount_cents := 0;
    new.tax_exemption_code := v_code;
  else
    -- Worked back from the gross, and the cuota is the remainder rather than
    -- a second rounding, so base + cuota is exactly what the patient paid.
    -- Mirrors facturaTaxFor() in utils/facturaTax.ts; a rectificativa's
    -- negative amount carries through both terms unchanged.
    new.tax_base_cents := round(new.amount_cents * 10000.0 / (10000 + v_rate));
    new.tax_rate_bp := v_rate;
    new.tax_amount_cents := new.amount_cents - new.tax_base_cents;
    new.tax_exemption_code := null;
  end if;

  return new;
end;
$$;

-- BEFORE INSERT, so the values are in place by the time facturas_record_alta
-- reads new.tax_amount_cents to build the registro de facturación.
drop trigger if exists facturas_fill_tax on facturas;
create trigger facturas_fill_tax
  before insert on facturas
  for each row execute function fill_factura_tax();

comment on function fill_factura_tax() is
  'Supplies base/rate/cuota/exemption for facturas inserted without them, so the schema and the app can be deployed in either order and no insert path can produce an untaxed factura.';
