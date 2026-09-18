-- The huella now matches AEAT's published algorithm, and is pinned to their
-- own test vector.
--
-- 20260917184429 shipped the chain with the formula marked
-- 'draft-2026-09-unverified', because the AEAT FAQ deferred to a PDF I could
-- not read at the time. That document is
-- "Detalle de las especificaciones técnicas para generación de la huella o
-- hash de los registros de facturación", AEAT, v0.1.2, 27/08/2024. It says:
--
--   * Concatenate as nombreCampo1=valor1&nombreCampo2=valor2&...
--   * Field names exactly as in the XML record design.
--   * Trim leading and trailing spaces from each value.
--   * Numeric values may carry one or two decimals; trailing zeros are not
--     significant, so 123.1 and 123.10 hash alike.
--   * A field that is absent or empty contributes just "nombreCampo=".
--   * SHA-256, output hexadecimal, UPPERCASE, 64 characters.
--
-- The field list and every rule above were already right. One thing was not:
-- FechaHoraHusoGenRegistro was written as UTC with a trailing Z, and the
-- specification's own example uses a local time with an explicit offset --
--
--   2024-01-01T19:20:30+01:00      not      2024-01-01T18:20:30Z
--
-- Same instant, different string, therefore a different hash. Every record
-- written so far is wrong, which is exactly the situation huella_spec_version
-- and rebuild_factura_huellas() were put there for, and why nothing was ever
-- submitted under the draft.
--
-- The offset is emitted as +HH:00. Spain has only whole-hour offsets, and a
-- half-hour zone would need the minutes rather than a literal ':00' -- worth
-- knowing before this is reused for a clinic outside Spain.

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
stable
set timezone to 'Europe/Madrid'
as $$
  select concat(
    'IDEmisorFactura=', btrim(coalesce(p_issuer_nif, '')),
    '&NumSerieFactura=', btrim(coalesce(p_serie_number, '')),
    '&FechaExpedicionFactura=', to_char(p_issued_on, 'DD-MM-YYYY'),
    '&TipoFactura=', btrim(coalesce(p_invoice_type, '')),
    '&CuotaTotal=', to_char(p_cuota_total_cents / 100.0, 'FM9999999990.00'),
    '&ImporteTotal=', to_char(p_importe_total_cents / 100.0, 'FM9999999990.00'),
    '&Huella=', btrim(coalesce(p_previous_huella, '')),
    -- Local time with the offset spelled out, per the example in the spec.
    '&FechaHoraHusoGenRegistro=',
      to_char(p_generated_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      to_char(p_generated_at, 'OF'), ':00'
  );
$$;

comment on function factura_huella_input(text, text, date, text, integer, integer, text, timestamptz) is
  'Builds the string hashed for a registro de alta, per AEAT "especificaciones técnicas para generación de la huella", v0.1.2. Verified against the worked example in section 6.1 of that document.';

-- rebuild_factura_huellas() could never have run.
--
-- As shipped it did "alter table factura_records disable trigger" inside a
-- loop over that same table, which Postgres refuses:
--
--   cannot ALTER TABLE "factura_records" because it is being used by active
--   queries in this session
--
-- It was defined and never executed, so nothing caught it -- and it was the
-- stated recovery path for exactly the situation this migration is in. That
-- is the kind of code that looks like a safety net right up until the moment
-- somebody needs it.
--
-- Replaced with an explicit, transaction-local declaration of intent. The
-- append-only trigger now allows an UPDATE only while that flag is set, and
-- never a DELETE: a rebuild rewrites huellas, it does not remove records.
create or replace function factura_records_are_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('quiroflow.rebuilding_huellas', true), '') = 'on' then
    return new;
  end if;

  raise exception
    'factura_records is append-only: a registro de facturación may not be % (id %)', tg_op, old.id
    using errcode = 'restrict_violation';
end;
$$;

create or replace function rebuild_factura_huellas(p_account_id uuid, p_spec_version text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  rows_to_rebuild factura_records[];
  r factura_records;
  v_prev text := null;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(p_account_id::text));

  -- Snapshotted first, so the chain is not being read and written at once.
  select array_agg(fr order by fr.sequence)
  into rows_to_rebuild
  from factura_records fr
  where fr.account_id = p_account_id;

  if rows_to_rebuild is null then
    return 0;
  end if;

  -- Transaction-local: it cannot outlive this call, so a rebuild cannot leave
  -- the table quietly writable afterwards.
  perform set_config('quiroflow.rebuilding_huellas', 'on', true);

  foreach r in array rows_to_rebuild loop
    update factura_records
    set previous_huella = v_prev,
        huella = factura_huella(factura_huella_input(
          r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
          r.cuota_total_cents, r.importe_total_cents, v_prev, r.generated_at
        )),
        huella_spec_version = p_spec_version
    where id = r.id
    returning huella into v_prev;

    v_count := v_count + 1;
  end loop;

  perform set_config('quiroflow.rebuilding_huellas', 'off', true);

  return v_count;
end;
$$;

-- Rebuild every chain under the corrected formula. Legitimate because nothing
-- has been submitted to the AEAT: until a record is sent it is our own data.
-- After the first submission this must never be run again.
do $$
declare
  a record;
  v_count integer;
begin
  for a in select distinct account_id from factura_records loop
    v_count := rebuild_factura_huellas(a.account_id, 'aeat-0.1.2');
    raise notice 'rebuilt % records for account %', v_count, a.account_id;
  end loop;
end;
$$;

-- A thin wrapper so a test can exercise the algorithm with arbitrary inputs,
-- which is what allows AEAT's published example to be run against it. Returns
-- both halves: the string that gets hashed, and the hash, because when this
-- test fails it is almost always the string that is wrong and seeing it is
-- the whole diagnosis.
create or replace function factura_huella_probe(
  p_issuer_nif text,
  p_serie_number text,
  p_issued_on date,
  p_invoice_type text,
  p_cuota_total_cents integer,
  p_importe_total_cents integer,
  p_previous_huella text,
  p_generated_at timestamptz
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'input', factura_huella_input(
      p_issuer_nif, p_serie_number, p_issued_on, p_invoice_type,
      p_cuota_total_cents, p_importe_total_cents, p_previous_huella, p_generated_at
    ),
    'huella', factura_huella(factura_huella_input(
      p_issuer_nif, p_serie_number, p_issued_on, p_invoice_type,
      p_cuota_total_cents, p_importe_total_cents, p_previous_huella, p_generated_at
    ))
  );
$$;
