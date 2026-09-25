-- VeriFactu is a per-clinic setting, not a deploy setting.
--
-- Whether records go to the AEAT at all, and to which of its services, was
-- decided by NUXT_VERIFACTU_ENVIRONMENT -- one value for every clinic on the
-- platform -- and the certificate's passphrase was one environment variable
-- too. That works for exactly one customer. A second clinic has its own
-- company, its own certificate, its own passphrase and its own go-live date.
--
-- So each account now says it for itself, from Settings > VeriFactu:
--
--   off    nothing is transmitted (records are still generated and chained,
--          so turning it on later has a complete history to send)
--   test   everything goes to the AEAT's test service
--   live   test service until verifactu_production_from, then the
--          production chain and the production service (see
--          20260924171847_verifactu_production_chain.sql)
--
-- Only an owner may change it. Once a production record exists the live
-- date is fixed and the mode cannot leave 'live': the AEAT holds that chain,
-- and a clinic in VERI*FACTU cannot simply stop sending.

alter table public.accounts
  add column if not exists verifactu_mode text not null default 'off';

alter table public.accounts
  drop constraint if exists accounts_verifactu_mode_check;
alter table public.accounts
  add constraint accounts_verifactu_mode_check
  check (verifactu_mode in ('off', 'test', 'live'));

-- Live needs a date to go live on.
alter table public.accounts
  drop constraint if exists accounts_verifactu_live_has_date;
alter table public.accounts
  add constraint accounts_verifactu_live_has_date
  check (verifactu_mode <> 'live' or verifactu_production_from is not null);

comment on column public.accounts.verifactu_mode is
  'off: nothing transmitted. test: AEAT test service. live: test service until verifactu_production_from, production chain and service from then on. Owner-only; locked once a production record exists.';

-- Columnaquiro is the one clinic already transmitting (to the test service),
-- and goes live with the 2027 facturas. Matches nothing elsewhere.
update public.accounts
set verifactu_mode = 'live'
where id = 'ff112316-8768-4e5a-a495-b5025cefb6f2'
  and verifactu_production_from is not null;

-- The production chain now also needs the clinic to be live, not only the
-- date to have passed: a date left on an account switched back to 'test' must
-- not start a production chain. Otherwise identical to 20260924171847.
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

-- Who may change the setting, and when it can no longer change.
--
-- accounts' own update policy lets any member update the row, which is right
-- for most of it and wrong for this. The owner check applies to a signed-in
-- caller; the lock applies to EVERYONE, service role included -- the settings
-- endpoint runs as the service role, and "the AEAT already holds a production
-- chain" is not something a role should be able to talk its way past.
create or replace function public.accounts_guard_verifactu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started boolean;
begin
  if new.verifactu_mode is not distinct from old.verifactu_mode
     and new.verifactu_production_from is not distinct from old.verifactu_production_from then
    return new;
  end if;

  if auth.uid() is not null and not exists (
    select 1 from public.team_members tm
    where tm.account_id = new.id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
  ) then
    raise exception 'Only an owner can change the VeriFactu settings' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.factura_records r
    where r.account_id = new.id and r.environment = 'production'
  ) into v_started;

  if v_started then
    if new.verifactu_production_from is distinct from old.verifactu_production_from then
      raise exception 'The live date cannot change: the production chain has already started' using errcode = '42501';
    end if;
    if new.verifactu_mode <> 'live' then
      raise exception 'VeriFactu cannot be switched off or back to test once records have gone to production' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_guard_verifactu on public.accounts;
create trigger accounts_guard_verifactu
  before update of verifactu_mode, verifactu_production_from on public.accounts
  for each row execute function public.accounts_guard_verifactu();

comment on table public.verifactu_certificates is
  'The PKCS#12 certificate each account transmits with, base64-encoded. Service role only; RLS denies everyone. Its passphrase is in account_secrets (verifactu_certificate_passphrase), encrypted with the platform key NUXT_VERIFACTU_SECRET_KEY -- so neither the database nor the deploy is enough on its own.';
