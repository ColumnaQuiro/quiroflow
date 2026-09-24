-- A factura keeps the issuer it was issued by.
--
-- The recipient side of a factura has been freezable for a while
-- (recipient_name / recipient_nif / recipient_address). The issuer side had
-- nothing: facturaData.ts read name, legal name, address, NIF, footer and logo
-- from `clinics` every time the PDF was rendered. So editing the clinic's
-- address or NIF in Settings -> Clinics / Fiscal Data silently rewrote every
-- factura the clinic had ever issued, the next time one was downloaded or
-- re-sent -- on a document that is a chain-signed fiscal record under
-- VERI*FACTU and must read the same in ten years as the day it was issued.
--
-- It also always read the account's OLDEST clinic, so on a multi-clinic
-- account a factura for a visit at the second clinic printed the first
-- clinic's name and address.
--
-- WHICH CLINIC, AND WHICH PARTS OF IT
--
-- Two different questions, answered separately:
--
--   * The establishment -- name, address, footer, logo -- is the clinic the
--     money was for: the visit's clinic (payment -> invoice -> appointment),
--     the corrected factura's clinic for a rectificativa, else the account's
--     default (oldest) clinic, which is the right answer for a bono,
--     membership or money on account that has no visit behind it.
--
--   * The legal identity -- legal name and NIF -- is the obligado tributario,
--     and that is the account's default clinic, ALWAYS. It is the NIF
--     record_factura_alta hashes as IDEmisorFactura (same query, same order),
--     and the legal name verifactuSender sends as NombreRazon. The chain is
--     one per account with a single obligado in the Cabecera, so printing a
--     second clinic's own NIF would put a NIF on the document that is not the
--     one registered with the AEAT for it. An account whose clinics are
--     genuinely different legal entities is not supported by the chain at all;
--     that is a bigger change than this one, and this does not pretend to
--     solve it.
--
-- NOTHING HASHED CHANGES
--
-- record_factura_alta is not touched. The huella inputs are IDEmisorFactura,
-- NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal,
-- ImporteTotal, the previous huella and FechaHoraHusoGenRegistro; none of
-- them are these columns. issuer_tax_id is filled by the same lookup the
-- record uses, in the same transaction, so on every new factura it equals
-- factura_records.issuer_nif (modulo '' for a clinic with no NIF, which the
-- record coalesces and this keeps null). The backfill below reads it FROM the
-- record where one exists, so old rows agree with what was actually hashed.
--
-- A TRIGGER, NOT A FIELD IN THE INSERT
--
-- Same argument as fill_factura_tax and record_factura_alta: facturas has
-- three insert paths (the desk, issueFacturaServer, issueRectificativa) and
-- the release currently deployed knows nothing about these columns. A BEFORE
-- INSERT trigger covers every path, including that release, so this migration
-- and the code reading it can go live in either order. The issuer is always
-- derived here, never taken from the caller: who issued a fiscal document is
-- not something the inserting client gets to say.

-- issuer_clinic_id is deliberately NOT a foreign key. It is part of the
-- snapshot, and a snapshot outlives what it was taken from. It would also be
-- a second path between facturas and clinics that makes facturas a junction
-- table in PostgREST's eyes, so existing embeds (rooms.vue, the waitlist
-- endpoint) would start failing with PGRST201 against the release already
-- live -- check:migration-compatibility refuses it for exactly that reason.
alter table facturas
  add column if not exists issuer_clinic_id uuid,
  add column if not exists issuer_name text,
  add column if not exists issuer_legal_name text,
  add column if not exists issuer_address text,
  add column if not exists issuer_tax_id text,
  add column if not exists issuer_footer_text text,
  add column if not exists issuer_logo_storage_path text;

comment on column facturas.issuer_clinic_id is
  'The establishment this factura was issued from (the visit''s clinic, or the account default). Set by fill_factura_issuer. Not a foreign key: it is a record of what was, and may name a clinic since deleted.';
comment on column facturas.issuer_name is
  'Issuer snapshot taken at issue time (with issuer_legal_name, issuer_address, issuer_tax_id, issuer_footer_text, issuer_logo_storage_path). The PDF prints these, not the live clinic, so later edits in Settings do not rewrite issued facturas. Rows from before 20260924135318 were backfilled with the values as of that migration.';
comment on column facturas.issuer_tax_id is
  'The obligado''s NIF as of issue: the same value record_factura_alta hashed as IDEmisorFactura. Always the account default clinic''s, even when issuer_clinic_id is another clinic.';

-- Kept small and separate so the backfill and the trigger cannot disagree
-- about which clinic a factura belongs to.
create or replace function factura_issuer_clinic_id(p_account_id uuid, p_payment_id uuid, p_rectifies_factura_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_clinic uuid;
begin
  -- A rectificativa corrects a specific document, and belongs to wherever
  -- that one was issued from -- not to the refund's own payment, which has
  -- no visit behind it.
  if p_rectifies_factura_id is not null then
    select coalesce(f.issuer_clinic_id, factura_issuer_clinic_id(f.account_id, f.payment_id, null))
    into v_clinic
    from facturas f
    where f.id = p_rectifies_factura_id
      and f.account_id = p_account_id;
    if v_clinic is not null then
      return v_clinic;
    end if;
  end if;

  if p_payment_id is not null then
    select a.clinic_id
    into v_clinic
    from payments p
    join invoices i on i.id = p.invoice_id
    join appointments a on a.id = i.appointment_id
    join clinics c on c.id = a.clinic_id and c.account_id = p_account_id
    where p.id = p_payment_id;
    if v_clinic is not null then
      return v_clinic;
    end if;
  end if;

  select c.id
  into v_clinic
  from clinics c
  where c.account_id = p_account_id
  order by c.created_at
  limit 1;

  return v_clinic;
end;
$$;

create or replace function fill_factura_issuer()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_establishment clinics%rowtype;
  v_obligado clinics%rowtype;
begin
  new.issuer_clinic_id := factura_issuer_clinic_id(new.account_id, new.payment_id, new.rectifies_factura_id);

  select * into v_establishment from clinics c where c.id = new.issuer_clinic_id;

  -- Must stay the query record_factura_alta runs for v_nif: that is what
  -- makes the printed NIF and the hashed IDEmisorFactura the same value.
  select * into v_obligado
  from clinics c
  where c.account_id = new.account_id
  order by c.created_at
  limit 1;

  new.issuer_name := v_establishment.name;
  new.issuer_address := v_establishment.address;
  new.issuer_footer_text := v_establishment.invoice_footer_text;
  -- Logo uploads are written to a fresh timestamped path and the old object
  -- is left in place (ClinicLogoUpload.vue), so the path alone freezes the
  -- image.
  new.issuer_logo_storage_path := v_establishment.logo_storage_path;
  new.issuer_legal_name := v_obligado.legal_name;
  new.issuer_tax_id := v_obligado.tax_id;

  return new;
end;
$$;

-- Backfill, BEFORE the guard below exists.
--
-- This can only capture TODAY's values. Nothing recorded what the clinic's
-- name, address or footer were when an older factura was issued, so a clinic
-- that edited them before this migration will see its old facturas carry the
-- edited version -- exactly what they were already showing, now made
-- permanent rather than still moving.
--
-- The NIF is the exception: factura_records kept the NIF that was hashed, so
-- that is used where a record exists, and today's value only where none does.
update facturas f
set issuer_clinic_id = factura_issuer_clinic_id(f.account_id, f.payment_id, f.rectifies_factura_id)
where f.issuer_clinic_id is null;

update facturas f
set issuer_name = c.name,
    issuer_address = c.address,
    issuer_footer_text = c.invoice_footer_text,
    issuer_logo_storage_path = c.logo_storage_path
from clinics c
where c.id = f.issuer_clinic_id
  and f.issuer_name is null;

update facturas f
set issuer_legal_name = (
      select c.legal_name from clinics c
      where c.account_id = f.account_id
      order by c.created_at
      limit 1
    ),
    issuer_tax_id = coalesce(
      (select nullif(r.issuer_nif, '')
       from factura_records r
       where r.factura_id = f.id and r.record_type = 'alta'),
      (select c.tax_id from clinics c
       where c.account_id = f.account_id
       order by c.created_at
       limit 1)
    )
where f.issuer_legal_name is null
  and f.issuer_tax_id is null;

drop trigger if exists facturas_fill_issuer on facturas;
create trigger facturas_fill_issuer
  before insert on facturas
  for each row execute function fill_factura_issuer();

-- Once taken, the snapshot does not move. An issued factura with the wrong
-- issuer is corrected by a rectificativa, not by editing it -- the same rule
-- factura_records already enforces for the hashed fields. A row with no
-- snapshot yet (an account that had no clinic when it was issued) can still
-- be filled once.
create or replace function facturas_issuer_is_frozen()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.issuer_name is not null
     and (new.issuer_clinic_id, new.issuer_name, new.issuer_legal_name, new.issuer_address,
          new.issuer_tax_id, new.issuer_footer_text, new.issuer_logo_storage_path)
         is distinct from
         (old.issuer_clinic_id, old.issuer_name, old.issuer_legal_name, old.issuer_address,
          old.issuer_tax_id, old.issuer_footer_text, old.issuer_logo_storage_path)
  then
    raise exception 'The issuer of factura % was fixed when it was issued and cannot be changed; issue a rectificativa instead.', old.number
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists facturas_issuer_frozen on facturas;
create trigger facturas_issuer_frozen
  before update on facturas
  for each row execute function facturas_issuer_is_frozen();

-- Trigger functions and an internal helper: nothing should reach them over
-- HTTP. See 20260923094500 for why this is FROM PUBLIC.
revoke execute on function public.fill_factura_issuer() from public, anon, authenticated;
revoke execute on function public.facturas_issuer_is_frozen() from public, anon, authenticated;
revoke execute on function public.factura_issuer_clinic_id(uuid, uuid, uuid) from public, anon, authenticated;
