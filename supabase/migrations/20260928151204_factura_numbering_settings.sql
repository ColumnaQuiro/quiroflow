-- Settings > Receipt Settings > Factura numbering: each clinic chooses the
-- prefix of its facturas and rectificativas, and where this year's count
-- continues from -- typically the next number of the system it is leaving,
-- so the series carries on instead of restarting at 0001 mid-year.
--
-- What stays fixed is the shape, PREFIX-YEAR-NNNN, and that the count starts
-- again every year. The sequence is still keyed by series ('F' / 'R') rather
-- than by prefix, so renaming a prefix mid-year continues the same count
-- instead of starting a second one from 0001.

alter table accounts
  add column factura_prefix text not null default 'F',
  add column rectificativa_prefix text not null default 'R';

-- Letters and digits only: the number goes into NumSerieFactura, into a QR
-- query string and into file names, and a '-' inside the prefix would make
-- PREFIX-YEAR-NNNN ambiguous to read back.
alter table accounts
  add constraint accounts_factura_prefix_shape
    check (factura_prefix ~ '^[A-Za-z0-9]{1,10}$'),
  add constraint accounts_rectificativa_prefix_shape
    check (rectificativa_prefix ~ '^[A-Za-z0-9]{1,10}$'),
  -- The two series share one unique index on (account_id, number), so equal
  -- prefixes would hand out F-2026-0003 twice and the second factura would
  -- quietly fail to issue.
  add constraint accounts_factura_prefixes_differ
    check (upper(factura_prefix) <> upper(rectificativa_prefix));

comment on column accounts.factura_prefix is
  'Prefix of ordinary facturas: <prefix>-<year>-<nnnn>. Counted by factura_number_sequences series F.';
comment on column accounts.rectificativa_prefix is
  'Prefix of rectificativas: <prefix>-<year>-<nnnn>. Counted by factura_number_sequences series R.';

-- Whose clock a factura's date and year are read on: the clinic's own zone
-- (Settings > Clinics), not the server's UTC and not always Madrid's: a
-- clinic in the Canaries runs an hour behind the peninsula, so its New Year
-- starts an hour after Madrid's. The account's first clinic, the same one whose NIF the registro carries
-- (record_factura_alta); a factura that names its issuing clinic uses that
-- one's zone instead, below.
create or replace function public.account_timezone(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select c.timezone from clinics c
      where c.account_id = p_account_id
      order by c.created_at
      limit 1),
    'Europe/Madrid'
  );
$function$;

revoke all on function public.account_timezone(uuid) from public, anon, authenticated;

-- The year a number belongs to is the clinic's, not UTC's: a factura issued
-- at 00:30 on 1 January belongs to the new year's series, and until now it
-- opened it only an hour or two later.
create or replace function public.next_factura_number(p_account_id uuid, p_series text default 'F')
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year integer := extract(year from (now() at time zone account_timezone(p_account_id)))::integer;
  v_number bigint;
  v_series text := upper(coalesce(p_series, 'F'));
  v_prefix text;
  v_candidate text;
begin
  if v_series not in ('F', 'R') then
    raise exception 'Unknown factura series: %', p_series;
  end if;

  if auth.uid() is not null and not has_permission(p_account_id, 'payments_allocate') then
    raise exception 'Not permitted';
  end if;

  select case v_series when 'F' then a.factura_prefix else a.rectificativa_prefix end
    into v_prefix
  from accounts a
  where a.id = p_account_id;
  v_prefix := coalesce(v_prefix, v_series);

  -- Skips a number already taken. Only reachable by renaming a prefix to one
  -- the other series used earlier this year; without it that factura would
  -- hit the unique index and not be issued at all, which is worse than a gap.
  loop
    insert into factura_number_sequences (account_id, year, series, next_number)
    values (p_account_id, v_year, v_series, 2)
    on conflict (account_id, year, series) do update
      set next_number = factura_number_sequences.next_number + 1,
          updated_at = now()
    returning next_number - 1 into v_number;

    v_candidate := v_prefix || '-' || v_year || '-' || lpad(v_number::text, 4, '0');
    exit when not exists (
      select 1 from facturas f where f.account_id = p_account_id and f.number = v_candidate
    );
  end loop;

  return v_candidate;
end;
$function$;

-- What the settings card shows: this year's prefixes and the next number of
-- each series. factura_number_sequences has no read policy, and should keep
-- none -- the count is only ever moved through the functions here.
create or replace function public.get_factura_numbering(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year integer := extract(year from (now() at time zone account_timezone(p_account_id)))::integer;
  v_result jsonb;
begin
  if auth.uid() is not null
     and not (is_account_member(p_account_id) and has_permission(p_account_id, 'billing_config')) then
    raise exception 'Not permitted';
  end if;

  select jsonb_build_object(
    'year', v_year,
    'factura_prefix', a.factura_prefix,
    'rectificativa_prefix', a.rectificativa_prefix,
    'next_factura', coalesce((select s.next_number from factura_number_sequences s
                              where s.account_id = a.id and s.year = v_year and s.series = 'F'), 1),
    'next_rectificativa', coalesce((select s.next_number from factura_number_sequences s
                                    where s.account_id = a.id and s.year = v_year and s.series = 'R'), 1)
  )
  into v_result
  from accounts a
  where a.id = p_account_id;

  return v_result;
end;
$function$;

-- Saves the card. The next numbers only move forward: going back would hand
-- out a number already on a factura -- the unique index refuses that, and the
-- factura for that payment would not be issued. Forward leaves a gap, which
-- is what continuing another system's series looks like anyway.
create or replace function public.set_factura_numbering(
  p_account_id uuid,
  p_factura_prefix text,
  p_rectificativa_prefix text,
  p_next_factura bigint,
  p_next_rectificativa bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year integer := extract(year from (now() at time zone account_timezone(p_account_id)))::integer;
  v_series text;
  v_next bigint;
  v_current bigint;
begin
  if auth.uid() is not null
     and not (is_account_member(p_account_id) and has_permission(p_account_id, 'billing_config')) then
    raise exception 'Not permitted';
  end if;

  -- The check constraints on accounts are the floor; these say it in words,
  -- where a violated constraint prints the whole accounts row.
  if coalesce(btrim(p_factura_prefix), '') !~ '^[A-Za-z0-9]{1,10}$'
     or coalesce(btrim(p_rectificativa_prefix), '') !~ '^[A-Za-z0-9]{1,10}$' then
    raise exception 'A prefix is 1 to 10 letters or digits'
      using errcode = '22023';
  end if;
  if upper(btrim(p_factura_prefix)) = upper(btrim(p_rectificativa_prefix)) then
    raise exception 'Facturas and rectificativas need different prefixes'
      using errcode = '22023';
  end if;

  update accounts
     set factura_prefix = btrim(p_factura_prefix),
         rectificativa_prefix = btrim(p_rectificativa_prefix)
   where id = p_account_id;

  -- Serialises with next_factura_number: both go through the sequence row.
  foreach v_series in array array['F', 'R'] loop
    v_next := case v_series when 'F' then p_next_factura else p_next_rectificativa end;
    continue when v_next is null;

    if v_next < 1 or v_next > 999999 then
      raise exception 'The next number must be between 1 and 999999'
        using errcode = '22023';
    end if;

    select s.next_number into v_current
    from factura_number_sequences s
    where s.account_id = p_account_id and s.year = v_year and s.series = v_series
    for update;

    if v_next < coalesce(v_current, 1) then
      raise exception 'The next number can only move forward: % is already in use this year (next is %)',
        v_next, v_current
        using errcode = '22023';
    end if;

    insert into factura_number_sequences (account_id, year, series, next_number)
    values (p_account_id, v_year, v_series, v_next)
    on conflict (account_id, year, series) do update
      set next_number = excluded.next_number,
          updated_at = now();
  end loop;

  return get_factura_numbering(p_account_id);
end;
$function$;

revoke all on function public.get_factura_numbering(uuid) from public, anon;
revoke all on function public.set_factura_numbering(uuid, text, text, bigint, bigint) from public, anon;
grant execute on function public.get_factura_numbering(uuid) to authenticated;
grant execute on function public.set_factura_numbering(uuid, text, text, bigint, bigint) to authenticated;

-- The registro's FechaExpedicionFactura, on the clinic's clock too -- the
-- issuing clinic's when the factura names one. It was the UTC date,
-- so a factura issued between midnight and 01:00/02:00 carried the previous
-- day -- and on 1 January, the previous YEAR, on a number of the new one.
-- Only records written from now on change: verify_factura_chain reads the
-- stored issued_on, so the records already in the chain still verify.
create or replace function public.record_factura_alta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_nif text;
  v_prev text;
  v_generated timestamptz := now();
  v_input text;
  v_environment text;
  v_issued_on date;
begin
  v_issued_on := (new.issued_at at time zone coalesce(
    (select c.timezone from clinics c where c.id = new.issuer_clinic_id),
    account_timezone(new.account_id)
  ))::date;

  perform pg_advisory_xact_lock(hashtext('factura_records'), hashtext(new.account_id::text));

  select c.tax_id into v_nif
  from clinics c
  where c.account_id = new.account_id
  order by c.created_at
  limit 1;

  select case
           when a.verifactu_mode = 'live'
                and a.verifactu_production_from is not null
                and v_generated >= a.verifactu_production_from
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
    v_issued_on,
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
    v_issued_on, factura_invoice_type(new.kind),
    coalesce(new.tax_amount_cents, 0), new.amount_cents, v_generated,
    v_prev, factura_huella(v_input), factura_huella_spec_version(), v_environment
  );

  return new;
end;
$function$;
