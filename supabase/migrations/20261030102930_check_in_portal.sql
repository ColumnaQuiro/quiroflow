-- The check-in portal: a tablet at a location's front desk where a patient
-- types their date of birth and is marked as arrived, without the app and
-- without signing in (pages/check-in/[token].vue). PracticeHub calls the same
-- thing its Check-in Portal, and clinics moving from it expect one.
--
-- One portal per location, reached by a random link. The tablet holds the
-- link and nothing else -- no staff session left open in the waiting room,
-- which is what PracticeHub's needs and what a patient could walk off with.
-- The link can do exactly one thing: find a visit at this location that is
-- about to start and mark it arrived. Turning the portal off deletes the row,
-- and with it the link; turning it on again makes a new one.
--
-- The token is kept as it is, not as a hash, because Settings shows the link
-- again to set up a second tablet. Only the service role reads this table:
-- the settings routes behind clinic_config and the portal's own routes.
--
-- `language` is what the tablet speaks until a patient picks another on it
-- (utils/checkInPortalText.ts). The three messages replace the standard
-- welcome, arrival and not-found wording, in that language only: a patient
-- who switches the tablet to English gets the standard English text, not the
-- clinic's Spanish. Null is the standard wording.
create table public.check_in_portals (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  token text not null unique,
  language text not null default 'es' check (language in ('es', 'en', 'fr', 'de', 'it', 'pt', 'ca')),
  welcome_message text check (char_length(welcome_message) <= 300),
  success_message text check (char_length(success_message) <= 300),
  not_found_message text check (char_length(not_found_message) <= 300),
  created_at timestamptz not null default now()
);

alter table public.check_in_portals enable row level security;
select public.require_two_factor_on('public.check_in_portals');
-- No policies: nothing reads it as a signed-in user.
select public.grant_data_api('public.check_in_portals');

-- Audit trail: who turned a location's portal on or off. The token column is
-- redacted by audit_is_secret.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['check_in_portal']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_check_in_portals after insert or update or delete on public.check_in_portals
  for each row execute function public.fn_audit_log('check_in_portal');
