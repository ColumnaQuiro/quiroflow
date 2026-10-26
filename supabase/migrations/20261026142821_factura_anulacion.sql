-- Annulling a factura that should never have been issued: a VERI*FACTU
-- registro de anulación.
--
-- Until now the only correction was a rectificativa. That is right for a
-- factura that documented a real operation and needs amending, and it is what
-- a refund issues. It is not right for one that should not exist at all -- a
-- payment recorded by mistake, a duplicate. For that case the AEAT's own
-- procedure is a registro de facturación de ANULACIÓN naming the original
-- factura; the alta stays on the record, now marked as annulled, and nothing
-- negative is issued in the R series.
--
-- record_type 'anulacion' has existed since 20260917184429, waiting for a
-- path that writes one. This is that path: annul_factura(). The sender
-- (server/utils/verifactuSender.ts) transmits it as a RegistroAnulacion.
--
-- The rectificativa route stays exactly as it was, beside this one. The
-- desk chooses between them in the same dialog.

-- What the anulación record hashes. Five fields, not the alta's eight, and
-- the first three carry the "Anulada" suffix -- from the AEAT's own
-- specification (Veri-Factu_especificaciones_huella_hash_registros.pdf
-- v0.1.2, section 5.b and worked example 6.3):
--
--   IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34
--   &FechaExpedicionFacturaAnulada=01-01-2024&Huella=F7B94CFD...2A2B97
--   &FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00
--   -> 177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68
--
-- Same timestamp and date formatting as factura_huella_input(), which the
-- alta vector already proved against the AEAT's own example.
create or replace function factura_anulacion_huella_input(
  p_issuer_nif text,
  p_serie_number text,
  p_issued_on date,
  p_previous_huella text,
  p_generated_at timestamptz
)
returns text
language sql
stable
set timezone to 'Europe/Madrid'
as $$
  select concat(
    'IDEmisorFacturaAnulada=', btrim(coalesce(p_issuer_nif, '')),
    '&NumSerieFacturaAnulada=', btrim(coalesce(p_serie_number, '')),
    '&FechaExpedicionFacturaAnulada=', to_char(p_issued_on, 'DD-MM-YYYY'),
    '&Huella=', btrim(coalesce(p_previous_huella, '')),
    '&FechaHoraHusoGenRegistro=',
      to_char(p_generated_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      to_char(p_generated_at, 'OF'), ':00'
  );
$$;

comment on function factura_anulacion_huella_input(text, text, date, text, timestamptz) is
  'The string a registro de anulación''s huella is computed over: IDEmisorFacturaAnulada, NumSerieFacturaAnulada, FechaExpedicionFacturaAnulada, the previous Huella and FechaHoraHusoGenRegistro (AEAT huella spec v0.1.2, 5.b).';

-- A record's huella, whichever kind it is, from a given predecessor. The one
-- place the verifier and the rebuild ask, so they cannot disagree about which
-- formula a row was built with.
create or replace function factura_record_huella(r factura_records, p_previous_huella text)
returns text
language sql
stable
set search_path to 'public', 'extensions'
as $$
  select factura_huella(case r.record_type
    when 'anulacion' then factura_anulacion_huella_input(
      r.issuer_nif, r.serie_number, r.issued_on, p_previous_huella, r.generated_at)
    else factura_huella_input(
      r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
      r.cuota_total_cents, r.importe_total_cents, p_previous_huella, r.generated_at)
  end);
$$;

-- The verifier, now recomputing an anulación with its own formula. Unchanged
-- otherwise (20260924171847): each environment is its own chain.
create or replace function public.verify_factura_chain(p_account_id uuid)
returns table (sequence bigint, factura_id uuid, serie_number text, problem text)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  r factura_records;
  v_prev text := null;
  v_environment text := null;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and not is_account_member(p_account_id) then
    raise exception 'not a member of account %', p_account_id using errcode = '42501';
  end if;

  for r in
    select * from factura_records
    where account_id = p_account_id
    order by factura_records.environment, factura_records.sequence
  loop
    if r.environment is distinct from v_environment then
      v_environment := r.environment;
      v_prev := null;
    end if;

    if r.previous_huella is distinct from v_prev then
      sequence := r.sequence;
      factura_id := r.factura_id;
      serie_number := r.serie_number;
      problem := 'broken_link';
      return next;
    end if;

    if r.huella_spec_version is distinct from factura_huella_spec_version() then
      sequence := r.sequence;
      factura_id := r.factura_id;
      serie_number := r.serie_number;
      problem := 'stale_spec_version';
      return next;
    elsif r.huella <> factura_record_huella(r, r.previous_huella) then
      sequence := r.sequence;
      factura_id := r.factura_id;
      serie_number := r.serie_number;
      problem := 'huella_mismatch';
      return next;
    end if;

    v_prev := r.huella;
  end loop;
end;
$$;

-- The rebuild, likewise. Still only meaningful for records nothing has been
-- submitted for; that rule lives with whoever calls it.
create or replace function public.rebuild_factura_huellas(p_account_id uuid, p_spec_version text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  rows_to_rebuild factura_records[];
  r factura_records;
  v_prev text := null;
  v_environment text := null;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(p_account_id::text));

  select array_agg(fr order by fr.environment, fr.sequence)
  into rows_to_rebuild
  from factura_records fr
  where fr.account_id = p_account_id;

  if rows_to_rebuild is null then
    return 0;
  end if;

  perform set_config('quiroflow.rebuilding_huellas', 'on', true);

  foreach r in array rows_to_rebuild loop
    if r.environment is distinct from v_environment then
      v_environment := r.environment;
      v_prev := null;
    end if;

    update factura_records
    set previous_huella = v_prev,
        huella = factura_record_huella(r, v_prev),
        huella_spec_version = p_spec_version
    where id = r.id
    returning huella into v_prev;

    v_count := v_count + 1;
  end loop;

  perform set_config('quiroflow.rebuilding_huellas', 'off', true);

  return v_count;
end;
$$;

-- The factura says it was annulled, so every list, report and PDF can tell
-- without reading the chain. The record is the fiscal fact; these columns
-- are its reflection, and only annul_factura() writes them (guard below).
--
-- annulled_by is a plain uuid, deliberately WITHOUT a foreign key to
-- auth.users: facturas already has one (created_by), and a second would make
-- every existing `users(...)` embed from facturas ambiguous (PGRST201) the
-- moment this applies -- under the release that is live, which cannot name
-- the relationship yet. check:migration-compatibility caught it.
alter table facturas
  add column if not exists annulled_at timestamptz,
  add column if not exists annulled_by uuid,
  add column if not exists annulment_reason text;

comment on column facturas.annulled_at is
  'Set when a registro de anulación was generated for this factura (annul_factura). An annulled factura stays on the series but documents nothing: reports leave it out.';

-- Staff can update facturas (the recipient freezes on delivery, for one), so
-- without this a REST call could mark a factura annulled with no anulación in
-- the chain -- or un-annul one the AEAT holds as annulled. Only
-- annul_factura() sets the flag that lets the change through.
create or replace function facturas_annulment_is_recorded()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if (new.annulled_at, new.annulled_by, new.annulment_reason)
       is distinct from (old.annulled_at, old.annulled_by, old.annulment_reason)
     and coalesce(current_setting('quiroflow.annulling_factura', true), '') <> 'on'
  then
    raise exception 'Factura % can only be annulled through annul_factura(), which records the anulación.', old.number
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists facturas_annulment_recorded on facturas;
create trigger facturas_annulment_recorded
  before update on facturas
  for each row execute function facturas_annulment_is_recorded();

-- Annul a factura: append its registro de anulación to the chain and mark it.
--
-- Only a factura whose payment is gone (payment_id null) -- the same
-- condition the desk's "Anular" has always had. That is the case an
-- anulación is for: the money it documents never came in. A factura whose
-- payment stands documents money the clinic did receive, and the way to undo
-- that is a refund, with its rectificativa.
--
-- Not a rectificativa, and not one a rectificativa already corrects: either
-- would leave an R-series document pointing at something that no longer
-- counts.
--
-- The anulación joins the SAME chain as the alta it annuls -- the AEAT
-- service that holds the alta is the one that must receive its anulación --
-- and its predecessor is whatever was last in that chain, like any record.
-- The sender holds it back until the alta itself has been accepted.
create or replace function public.annul_factura(p_factura_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  f facturas;
  alta factura_records;
  v_prev text;
  v_generated timestamptz := now();
  v_id uuid;
begin
  select * into f from facturas where id = p_factura_id for update;
  if not found then
    raise exception 'Factura % not found', p_factura_id using errcode = 'no_data_found';
  end if;

  -- Security definer: the caller's rights are checked here, as the desk's
  -- button checks them (financials_edit_all and payments_allocate). The
  -- service role (no auth.uid()) passes.
  if auth.uid() is not null then
    if not is_account_member(f.account_id) then
      raise exception 'not a member of account %', f.account_id using errcode = '42501';
    end if;
    if not mfa_satisfied() then
      raise exception 'Two-factor verification is required' using errcode = '42501';
    end if;
    if not (has_permission(f.account_id, 'financials_edit_all') and has_permission(f.account_id, 'payments_allocate')) then
      raise exception 'You do not have permission to annul facturas' using errcode = '42501';
    end if;
  end if;

  if f.annulled_at is not null then
    raise exception 'Factura % is already annulled', f.number using errcode = 'check_violation';
  end if;
  if f.kind = 'rectificativa' then
    raise exception 'Factura % is a rectificativa and cannot be annulled', f.number using errcode = 'check_violation';
  end if;
  if f.payment_id is not null then
    raise exception 'Factura % still has its payment; remove the payment or record a refund instead', f.number using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturas r where r.rectifies_factura_id = f.id) then
    raise exception 'Factura % is already corrected by a rectificativa', f.number using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(f.account_id::text));

  select * into alta from factura_records
  where factura_id = f.id and record_type = 'alta';
  if not found then
    raise exception 'Factura % has no registro de alta to annul', f.number using errcode = 'no_data_found';
  end if;

  select r.huella into v_prev
  from factura_records r
  where r.account_id = f.account_id
    and r.environment = alta.environment
  order by r.sequence desc
  limit 1;

  -- The annulled factura's identity, as the alta recorded it, so the AEAT is
  -- told about exactly the invoice it holds. An anulación has no type or
  -- amounts of its own: invoice_type repeats the alta's (the column is not
  -- null), and the totals are zero so nothing that sums records counts it.
  insert into factura_records (
    account_id, factura_id, record_type, issuer_nif, serie_number, issued_on,
    invoice_type, cuota_total_cents, importe_total_cents, generated_at,
    previous_huella, huella, huella_spec_version, environment
  ) values (
    f.account_id, f.id, 'anulacion', alta.issuer_nif, alta.serie_number, alta.issued_on,
    alta.invoice_type, 0, 0, v_generated,
    v_prev,
    factura_huella(factura_anulacion_huella_input(alta.issuer_nif, alta.serie_number, alta.issued_on, v_prev, v_generated)),
    factura_huella_spec_version(), alta.environment
  )
  returning id into v_id;

  perform set_config('quiroflow.annulling_factura', 'on', true);
  update facturas
  set annulled_at = v_generated,
      annulled_by = auth.uid(),
      annulment_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = f.id;
  perform set_config('quiroflow.annulling_factura', 'off', true);

  return v_id;
end;
$$;

revoke all on function public.annul_factura(uuid, text) from public, anon;
grant execute on function public.annul_factura(uuid, text) to authenticated, service_role;

comment on function public.annul_factura(uuid, text) is
  'Annuls a factura issued in error (its payment already removed): appends a VERI*FACTU registro de anulación to its chain and marks the factura annulled. Returns the new record id.';
