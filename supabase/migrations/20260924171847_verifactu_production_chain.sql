-- The production VeriFactu chain starts on its own, not from the test run.
--
-- Every registro carries the huella of the one before it, and the AEAT walks
-- that chain. Until now there was one chain per account, so the first real
-- record on 1 Jan 2027 would have carried the huella of the last 2026 TEST
-- record -- a record the AEAT's production service never received -- and
-- named it as its RegistroAnterior. The first thing production would ever
-- see from the clinic would point at something it does not hold.
--
-- 2026 is a test run for Columnaquiro (decided 24 Sep 2026): nothing issued
-- this year is submitted for real. So each account now has two chains:
--
--   test        every record generated before the account goes live
--   production  every record from `accounts.verifactu_production_from` on,
--               starting with a record that has no predecessor, which the
--               RegistroAlta builder already sends as PrimerRegistro = S
--
-- The split is by when the record is GENERATED, which is also what its
-- huella hashes. A factura issued at 23:59 on 31 Dec stays in the test chain,
-- and the first one after midnight (Madrid) opens the production one, with no
-- one having to be awake to flip a switch. The numbering needs nothing: the
-- F- and R- series are already per year, so 2027 starts at F-2027-0001.
--
-- Transmission still has its own switch. A production record is only ever
-- sent while the sender is configured for production (verifactuEnvironment),
-- and test records are only ever sent to the test service -- see
-- server/utils/verifactuSender.ts.

alter table public.accounts
  add column if not exists verifactu_production_from timestamptz;

comment on column public.accounts.verifactu_production_from is
  'When this clinic''s VeriFactu records start the production chain. Records generated before it form the test chain; null means everything is still test.';

-- Adding a column with a constant default fires no row trigger, so the
-- append-only guard on this table is not involved: no existing record is
-- updated. Every record so far is test.
alter table public.factura_records
  add column if not exists environment text not null default 'test';

alter table public.factura_records
  drop constraint if exists factura_records_environment_check;
alter table public.factura_records
  add constraint factura_records_environment_check check (environment in ('test', 'production'));

create index if not exists factura_records_account_environment_sequence_idx
  on public.factura_records (account_id, environment, sequence);

-- The record for a new factura: which chain it belongs to, and the huella of
-- the last record IN THAT CHAIN. Otherwise identical to the previous
-- definition.
create or replace function public.record_factura_alta()
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
  v_environment text;
begin
  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(new.account_id::text));

  select c.tax_id into v_nif
  from clinics c
  where c.account_id = new.account_id
  order by c.created_at
  limit 1;

  select case
           when a.verifactu_production_from is not null and v_generated >= a.verifactu_production_from
             then 'production'
           else 'test'
         end
    into v_environment
  from accounts a
  where a.id = new.account_id;
  v_environment := coalesce(v_environment, 'test');

  select r.huella into v_prev
  from factura_records r
  where r.account_id = new.account_id
    and r.environment = v_environment
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
    previous_huella, huella, huella_spec_version, environment
  ) values (
    new.account_id, new.id, 'alta', coalesce(v_nif, ''), new.number,
    (new.issued_at at time zone 'UTC')::date, factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0), new.amount_cents, v_generated,
    v_prev, factura_huella(v_input), factura_huella_spec_version(), v_environment
  );

  return new;
end;
$$;

-- Walks each chain on its own: the first production record has no
-- predecessor, and must not be reported as a broken link to the last test
-- record. Otherwise identical to the previous definition.
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
  v_expected text;
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
    else
      v_expected := factura_huella(factura_huella_input(
        r.issuer_nif, r.serie_number, r.issued_on, r.invoice_type,
        r.cuota_total_cents, r.importe_total_cents, r.previous_huella, r.generated_at
      ));

      if r.huella <> v_expected then
        sequence := r.sequence;
        factura_id := r.factura_id;
        serie_number := r.serie_number;
        problem := 'huella_mismatch';
        return next;
      end if;
    end if;

    v_prev := r.huella;
  end loop;
end;
$$;

-- Same split for the rebuild: each chain re-linked from its own first record.
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

revoke execute on function public.rebuild_factura_huellas(uuid, text) from public, anon, authenticated;

-- Columnaquiro goes live with the 2027 facturas: midnight on 1 Jan 2027,
-- Madrid time. Matches nothing on a database without that account.
update public.accounts
set verifactu_production_from = '2027-01-01 00:00:00 Europe/Madrid'
where id = 'ff112316-8768-4e5a-a495-b5025cefb6f2';
