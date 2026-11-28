-- A record that a clinic accepted the Terms of service and the Privacy policy,
-- and of which text.
--
-- QuiroFlow is the clinics' data processor (art. 28 GDPR), and that needs a
-- contract each clinic has actually agreed to. Until now the sign-up page did
-- not link either document and nothing was stored: there was no way to show
-- that any clinic had accepted anything.
--
-- The row is written by a trigger on auth.users, in the same statement that
-- creates the user, from the version pages/signup.vue sends as sign-up
-- metadata (utils/legalVersion.ts). Not by a call from the app afterwards:
-- with email confirmation on there is no session yet to make one with, and a
-- second request is one that can fail with nobody noticing.
--
-- Sign-ups that send no version (patients, from the app and the portal) write
-- nothing. Their relationship is with their clinic, not with QuiroFlow.

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- Kept when the person deletes their login: the acceptance is evidence of a
  -- contract, and `email` says whose it was once this is null.
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  -- The date of the text accepted, as utils/legalVersion.ts names it.
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now()
);

create index legal_acceptances_user_id_idx on public.legal_acceptances (user_id);

alter table public.legal_acceptances enable row level security;

-- Read your own, and nothing else. No insert, update or delete policy: the
-- only writer is the trigger below.
create policy "own legal acceptances" on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

-- New tables are no longer granted by default (30 Oct 2026). The helper gives
-- signed-in people the usual four; the writes are taken back at once, so the
-- table is read-only to them whatever a later policy says.
select public.grant_data_api('public.legal_acceptances');
revoke all on public.legal_acceptances from anon;
revoke insert, update, delete, truncate on public.legal_acceptances from authenticated;

select public.require_two_factor_on('public.legal_acceptances');

create function public.record_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := new.raw_user_meta_data ->> 'legal_version';
begin
  -- The metadata is whatever the client sent. Anything that is not a plain
  -- date is not a version this app ever shows, and is not stored.
  if v_version is null or v_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return new;
  end if;

  -- A fault here must not stop a clinic signing up: this runs inside the
  -- insert that creates the user. It is reported instead, where the database
  -- logs are read.
  begin
    insert into public.legal_acceptances (user_id, email, version)
    values (new.id, coalesce(new.email, ''), v_version);
  exception when others then
    raise warning 'legal acceptance not recorded for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.record_legal_acceptance() from public, anon, authenticated;

create trigger quiroflow_legal_acceptance
  after insert on auth.users
  for each row execute function public.record_legal_acceptance();
