-- The registro de facturación: one tamper-evident record per factura.
--
-- Second step towards VERI*FACTU, and still nothing is sent anywhere. What
-- this adds is the thing the regime is actually built on: an append-only
-- sequence of records where each one carries the huella of the one before it,
-- so removing or altering an invoice after the fact breaks every record that
-- followed it.
--
-- WHAT IS AND IS NOT VERIFIED
--
-- The field list is confirmed against two independent descriptions of AEAT's
-- spec and is the one below: IDEmisorFactura, NumSerieFactura,
-- FechaExpedicionFactura, TipoFactura, CuotaTotal, ImporteTotal, Huella of the
-- previous record, FechaHoraHusoGenRegistro.
--
-- The exact SEPARATORS, the date format and the decimal formatting are NOT
-- verified. AEAT's FAQ defers to "Detalle de las especificaciones técnicas
-- para la generación de la huella o hash de los registros", which is a PDF on
-- the developer portal, and every secondary source stops short of reproducing
-- it. So huella_spec_version records which formula produced each row, and
-- rebuild_factura_huellas() regenerates the whole chain under a new one.
--
-- That is safe precisely because nothing has been submitted: until a record
-- has been sent to the AEAT it is our own data and may be recomputed. Once
-- submission exists, it must not be -- which is why the version is on the row
-- from the first day rather than added later, when some rows would already be
-- untouchable and others not.
--
-- DO NOT build the AEAT submission on top of this until the formula has been
-- checked against that document and the chain rebuilt if it differs.

create table if not exists factura_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  factura_id uuid not null references facturas(id) on delete restrict,

  -- 'alta' for an invoice issued. 'anulacion' is for an invoice withdrawn
  -- without a rectificativa; nothing writes one yet, because facturas has no
  -- delete path -- the type exists so the table does not need altering the
  -- day it does.
  record_type text not null default 'alta' check (record_type in ('alta', 'anulacion')),

  -- Ordering within an issuer's chain. A sequence rather than a timestamp:
  -- two facturas issued in the same millisecond still have an unambiguous
  -- predecessor, which is the whole point.
  sequence bigint generated always as identity,

  -- The hashed fields, stored as they were hashed. Keeping them rather than
  -- re-reading facturas means a rebuilt chain can be compared against the
  -- original, and a record still verifies if the invoice row is later
  -- reshaped by a migration.
  issuer_nif text not null,
  serie_number text not null,
  issued_on date not null,
  invoice_type text not null,
  cuota_total_cents integer not null,
  importe_total_cents integer not null,
  generated_at timestamptz not null default now(),

  previous_huella text,
  huella text not null,
  huella_spec_version text not null,

  created_at timestamptz not null default now(),

  -- One alta per factura. A second would fork the chain.
  unique (factura_id, record_type)
);

create index if not exists factura_records_account_sequence_idx
  on factura_records (account_id, sequence desc);

alter table factura_records enable row level security;

-- Readable by the account, writable by nobody through the API. The records
-- are written by a trigger under the service role; a member who could insert
-- one could forge a link in the chain.
create policy "factura_records readable by account members"
  on factura_records for select
  using (is_account_member(account_id));

-- Append-only, enforced rather than promised. Postgres has no "insert-only"
-- privilege that survives a service-role connection, and the service role is
-- what the app uses, so the guarantee has to live in a trigger.
create or replace function factura_records_are_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'factura_records is append-only: a registro de facturación may not be % (id %)', tg_op, old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists factura_records_no_update on factura_records;
create trigger factura_records_no_update
  before update or delete on factura_records
  for each row execute function factura_records_are_append_only();

-- TipoFactura: AEAT's invoice type codes.
--
-- F1 is a full invoice, F2 a simplified one. R1 is the rectificativa code for
-- a correction under art. 80.One/Two or an error in law, which is what a
-- refund against a visit is. R2-R5 exist for insolvency, bad debt and the
-- rest; if the clinic ever needs one, this is where it is chosen, and the
-- choice belongs to the gestor rather than to whoever writes the code.
create or replace function factura_invoice_type(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'full' then 'F1'
    when 'simplified' then 'F2'
    when 'rectificativa' then 'R1'
    else 'F1'
  end;
$$;

-- The string that gets hashed.
--
-- Isolated in its own function so that confirming it against AEAT's document
-- is a one-line change plus a rebuild, rather than an archaeology exercise
-- across a trigger.
create or replace function factura_huella_input(
  p_issuer_nif text,
  p_serie_number text,
  p_issued_on date,
  p_invoice_type text,
  p_cuota_total_cents integer,
  p_importe_total_cents integer,
  p_previous_huella text,
  p_generated_at timestamptz
)
returns text
language sql
immutable
as $$
  select concat(
    'IDEmisorFactura=', coalesce(p_issuer_nif, ''),
    '&NumSerieFactura=', coalesce(p_serie_number, ''),
    '&FechaExpedicionFactura=', to_char(p_issued_on, 'DD-MM-YYYY'),
    '&TipoFactura=', coalesce(p_invoice_type, ''),
    '&CuotaTotal=', to_char(p_cuota_total_cents / 100.0, 'FM9999999990.00'),
    '&ImporteTotal=', to_char(p_importe_total_cents / 100.0, 'FM9999999990.00'),
    '&Huella=', coalesce(p_previous_huella, ''),
    '&FechaHoraHusoGenRegistro=', to_char(p_generated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
$$;

create or replace function factura_huella(p_input text)
returns text
language sql
immutable
as $$
  select upper(encode(extensions.digest(p_input, 'sha256'), 'hex'));
$$;

-- Writes the record for a factura the moment it is issued.
--
-- A trigger, not a call in the issuing code, because there are three paths
-- that create a factura -- the desk, the server-side twin for money that
-- arrives with nobody at a screen, and issueRectificativa -- and a record
-- that exists for two of them is worse than none: the chain would have holes
-- that look like deletions.
create or replace function record_factura_alta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_nif text;
  v_prev text;
  v_generated timestamptz := now();
  v_input text;
begin
  -- Serialise per issuer. Two facturas inserted concurrently would otherwise
  -- read the same predecessor and both claim to follow it, forking the chain
  -- silently -- the one failure mode that would make the whole record
  -- worthless while looking perfectly healthy.
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(new.account_id::text));

  select c.tax_id into v_nif
  from clinics c
  where c.account_id = new.account_id
  order by c.created_at
  limit 1;

  select r.huella into v_prev
  from factura_records r
  where r.account_id = new.account_id
  order by r.sequence desc
  limit 1;

  v_input := factura_huella_input(
    coalesce(v_nif, ''),
    new.number,
    (new.issued_at at time zone 'UTC')::date,
    factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0),
    new.amount_cents,
    v_prev,
    v_generated
  );

  insert into factura_records (
    account_id, factura_id, record_type, issuer_nif, serie_number, issued_on,
    invoice_type, cuota_total_cents, importe_total_cents, generated_at,
    previous_huella, huella, huella_spec_version
  ) values (
    new.account_id, new.id, 'alta', coalesce(v_nif, ''), new.number,
    (new.issued_at at time zone 'UTC')::date, factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0), new.amount_cents, v_generated,
    v_prev, factura_huella(v_input), 'draft-2026-09-unverified'
  );

  return new;
end;
$$;

drop trigger if exists facturas_record_alta on facturas;
create trigger facturas_record_alta
  after insert on facturas
  for each row execute function record_factura_alta();

-- Rebuilds a whole account's chain under the current formula.
--
-- Legitimate only while nothing has been submitted to the AEAT. It refuses
-- rather than trusting the caller to remember that, and the guard is a real
-- check of the rows, not a flag someone can forget to set.
create or replace function rebuild_factura_huellas(p_account_id uuid, p_spec_version text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  r record;
  v_prev text := null;
  v_input text;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(p_account_id::text));

  for r in
    select * from factura_records
    where account_id = p_account_id
    order by sequence
  loop
    v_input := factura_huella_input(
      r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
      r.cuota_total_cents, r.importe_total_cents, v_prev, r.generated_at
    );
    v_prev := factura_huella(v_input);

    -- The append-only trigger is the point of this table, so a rebuild has to
    -- step around it explicitly and visibly rather than the table quietly
    -- being updatable after all.
    alter table factura_records disable trigger factura_records_no_update;
    update factura_records
    set previous_huella = (
          select huella from factura_records p
          where p.account_id = p_account_id and p.sequence < r.sequence
          order by p.sequence desc limit 1
        ),
        huella = v_prev,
        huella_spec_version = p_spec_version
    where id = r.id;
    alter table factura_records enable trigger factura_records_no_update;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function rebuild_factura_huellas(uuid, text) is
  'Recomputes an account''s whole chain under the current formula. Only valid before any record has been submitted to the AEAT; after that, records are immutable in law as well as in this table.';

comment on table factura_records is
  'Append-only registro de facturación per RD 1007/2023. Each row carries the huella of its predecessor. Nothing here is submitted to the AEAT yet; see huella_spec_version.';

-- Backfill the records for facturas already issued, in the order they were
-- issued, so an account's chain starts where its invoice series does rather
-- than at whatever happens to be issued next.
--
-- Done here rather than left to the trigger, because the trigger only fires
-- on insert and these rows already exist. Chained per account, since each
-- issuer has its own sequence.
do $$
declare
  f record;
  v_nif text;
  v_prev text;
  v_generated timestamptz;
  v_input text;
begin
  for f in
    select fa.id, fa.account_id, fa.number, fa.kind, fa.issued_at, fa.created_at,
           fa.amount_cents, fa.tax_amount_cents
    from facturas fa
    order by fa.account_id, fa.issued_at, fa.created_at
  loop
    if not exists (select 1 from factura_records r where r.factura_id = f.id) then
      select c.tax_id into v_nif
      from clinics c where c.account_id = f.account_id
      order by c.created_at limit 1;

      select r.huella into v_prev
      from factura_records r
      where r.account_id = f.account_id
      order by r.sequence desc limit 1;

      -- The record is generated now, but it describes an invoice issued then;
      -- FechaHoraHusoGenRegistro is when the RECORD was made, so the honest
      -- value is the backfill's own timestamp rather than a backdated one.
      v_generated := now();

      v_input := factura_huella_input(
        coalesce(v_nif, ''), f.number, (f.issued_at at time zone 'UTC')::date,
        factura_invoice_type(f.kind), coalesce(f.tax_amount_cents, 0),
        f.amount_cents, v_prev, v_generated
      );

      insert into factura_records (
        account_id, factura_id, record_type, issuer_nif, serie_number, issued_on,
        invoice_type, cuota_total_cents, importe_total_cents, generated_at,
        previous_huella, huella, huella_spec_version
      ) values (
        f.account_id, f.id, 'alta', coalesce(v_nif, ''), f.number,
        (f.issued_at at time zone 'UTC')::date, factura_invoice_type(f.kind),
        coalesce(f.tax_amount_cents, 0), f.amount_cents, v_generated,
        v_prev, factura_huella(v_input), 'draft-2026-09-unverified'
      );
    end if;
  end loop;
end;
$$;
