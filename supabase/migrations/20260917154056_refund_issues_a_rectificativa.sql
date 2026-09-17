-- A refund leaves the factura it refunds standing.
--
-- createRefund() writes the REF- invoice, the line item and the negative
-- payment, and issues no fiscal document at all -- the call was never wired
-- up. So the factura saying the money came in stays in the series, and
-- nothing says it went back.
--
-- Every refund the clinic has ever made is affected: all five post-date
-- facturas going live, and not one has a rectifying document. 206 EUR of the
-- 2026 series documents money that was returned the same day (they are the
-- bono double-charge corrections -- "sesión ya cubierta por el bono").
--
-- RD 1619/2012 art. 15 wants a factura rectificativa when an operation is
-- annulled or its amount changes, and that covers simplified invoices too.

-- ---------------------------------------------------------------------
-- Its own series
--
-- R-2026-0001, separate from F-2026-NNNN, the same way REF- is separate from
-- INV-. Two reasons: the F- series stays a clean record of money in, which is
-- what anyone reconciling takings against it expects; and a rectificativa
-- carrying a number out of the same run reads, at a glance, like another sale.
alter table factura_number_sequences add column series text not null default 'F';

alter table factura_number_sequences drop constraint factura_number_sequences_pkey;
alter table factura_number_sequences add primary key (account_id, year, series);

comment on column factura_number_sequences.series is
  'F for facturas, R for rectificativas. Each series counts independently, per account per year.';

-- The one-argument version has to GO, not be left alongside this. Adding an
-- overload leaves both resolvable: a call with only p_account_id still picks
-- the old one, whose `on conflict (account_id, year)` no longer names a
-- constraint that exists -- so every factura silently stopped being issued
-- while the payment went through exactly as before. Which is the failure this
-- whole table was introduced to stop.
drop function if exists next_factura_number(uuid);

-- Default on p_series so the six existing call sites keep working unchanged;
-- only the refund path passes anything else.
create or replace function next_factura_number(p_account_id uuid, p_series text default 'F')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_number bigint;
  v_series text := upper(coalesce(p_series, 'F'));
begin
  if v_series not in ('F', 'R') then
    raise exception 'Unknown factura series: %', p_series;
  end if;

  if auth.uid() is not null and not has_permission(p_account_id, 'payments_allocate') then
    raise exception 'Not permitted';
  end if;

  -- Same shape as next_invoice_number(): the upsert takes a row lock, so two
  -- concurrent callers serialize rather than both reading the same value. A
  -- count would not do -- it falls when a row is deleted, which is how seven
  -- invoice numbers came to be held by two patients each.
  insert into factura_number_sequences (account_id, year, series, next_number)
  values (p_account_id, v_year, v_series, 2)
  on conflict (account_id, year, series) do update
    set next_number = factura_number_sequences.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_number;

  return v_series || '-' || v_year || '-' || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function next_factura_number(uuid, text) from public;
grant execute on function next_factura_number(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- What a rectificativa is

alter table facturas drop constraint facturas_kind_check;
alter table facturas add constraint facturas_kind_check
  check (kind in ('simplified', 'full', 'rectificativa'));

-- Which document this one corrects. Nullable, and not only for the rows that
-- predate this: a refund against an invoice settled by several payments has
-- several facturas behind it and no single one to name. The document is still
-- issued in that case -- it is the document that is required, not the link --
-- and its description names what it can.
alter table facturas add column rectifies_factura_id uuid references facturas(id) on delete set null;

create index facturas_rectifies_idx on facturas (rectifies_factura_id) where rectifies_factura_id is not null;

comment on column facturas.rectifies_factura_id is
  'The factura this one corrects. Set when the refunded invoice had exactly one factura behind it.';

-- A rectificativa carries the negative amount, so the existing
-- "amount_cents not null" is all the constraint there is -- deliberately, since
-- the sign is what distinguishes it from the document it corrects.
comment on column facturas.amount_cents is
  'Negative on a rectificativa: the amount going back to the patient.';
