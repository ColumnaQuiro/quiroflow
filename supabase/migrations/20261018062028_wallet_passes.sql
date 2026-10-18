-- A bono in Apple Wallet (server/utils/walletPass.ts): the patient adds it
-- from the app or the portal, and it keeps itself current -- sessions left,
-- the next visit -- through Apple's PassKit web service
-- (server/api/wallet/v1/*) and a push when something changes.
--
-- Keyed by the bono, not the patient: merge_patients moves package_purchases
-- and anonymize_patient keeps them, so neither needs a line for these tables.
-- Only the service role reads or writes them; the web service is called by
-- the patient's device with the pass's own authentication token.

create table if not exists public.wallet_passes (
  package_purchase_id uuid primary key references public.package_purchases(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Apple sends it back as "Authorization: ApplePass <token>".
  auth_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  -- Last change to anything the pass shows; Apple asks "what changed since".
  updated_at timestamptz not null default now(),
  -- Last time the devices holding it were told to fetch it again.
  pushed_at timestamptz
);
create index if not exists wallet_passes_account on public.wallet_passes (account_id);

create table if not exists public.wallet_registrations (
  device_library_id text not null,
  package_purchase_id uuid not null references public.wallet_passes(package_purchase_id) on delete cascade,
  push_token text not null,
  created_at timestamptz not null default now(),
  primary key (device_library_id, package_purchase_id)
);
create index if not exists wallet_registrations_purchase on public.wallet_registrations (package_purchase_id);

alter table public.wallet_passes enable row level security;
alter table public.wallet_registrations enable row level security;
select public.require_two_factor_on('public.wallet_passes');
select public.require_two_factor_on('public.wallet_registrations');

-- What the pass shows changed: the sessions, the bono itself, or the
-- patient's visits (the next one is on the pass). The daily cron pushes the
-- passes whose updated_at is past their pushed_at.
create or replace function public.wallet_passes_touch_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update wallet_passes set updated_at = now() where package_purchase_id = new.id;
  return new;
end;
$$;
drop trigger if exists wallet_passes_touch_purchase on public.package_purchases;
create trigger wallet_passes_touch_purchase
  after update of sessions_used, sessions_total, is_closed, package_name on public.package_purchases
  for each row execute function public.wallet_passes_touch_purchase();

create or replace function public.wallet_passes_touch_patient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid := coalesce(new.patient_id, old.patient_id);
begin
  if v_patient is not null then
    update wallet_passes w set updated_at = now()
    from package_purchases pp
    where pp.id = w.package_purchase_id and pp.patient_id = v_patient;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists wallet_passes_touch_patient on public.appointments;
create trigger wallet_passes_touch_patient
  after insert or delete or update of starts_at, status, deleted_at on public.appointments
  for each row execute function public.wallet_passes_touch_patient();
