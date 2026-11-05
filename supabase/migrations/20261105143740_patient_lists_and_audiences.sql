-- Audiences: lists of patients, and segments that keep track of who is in
-- them, so a campaign can be aimed at either and an automation can start
-- when someone enters one (the way Customer.io does it).
--
-- What already existed, and is built on rather than beside:
--
--   * patient_segments (20261022173310): saved filters on the patient list,
--     evaluated by patients_matching(). That stays THE rule engine. The
--     Patients table, its export, the segment counts and now the segment
--     membership below all go through it, so a segment holds exactly the
--     people opening it shows.
--   * patients.tags: free text, much of it migrated compound values
--     ("1x10|No contactar"). Tags stay attributes -- a segment can still ask
--     for one. A list is not a tag: it records who added each person, when,
--     and from where (by hand, a bulk selection or an import), and "when" is
--     what an "entered the list" trigger needs.
--   * family (patient_relations, 20261021171628, and the bono-sharing graph,
--     package_share_edges): new segment conditions below, not a new model.
--
-- Three tables:
--
--   patient_lists            a name, shared with the team or private
--   patient_list_members     who is on each list, added when, by whom, how
--   patient_segment_members  who is in each segment, entered when, left when
--
-- A segment's membership is a snapshot, refreshed by refresh_segment_members()
-- every fifteen minutes (pg_cron, below) and straight after its filters are
-- saved. Rows are never rewritten: entering adds one, leaving stamps left_at,
-- entering again adds another. So "who entered since T" is one indexed read,
-- for lists and segments alike (audience_entries_since), which is what the
-- automation engine needs to enrol people as they arrive.
--
-- Being on a list or in a segment is never consent. Every send still checks
-- marketing_channels and do_not_contact, per channel, as it does now.
--
-- Each new table holds a patient_id, so merge_patients moves them (restated
-- at the end of this file) and anonymisation removes them (a trigger on
-- anonymized_at, the way patient_relations does it). Two-factor and the data
-- API grants on all three; the audit trail on the two people edit by hand.
-- patient_segment_members is derived -- recomputed every fifteen minutes --
-- so auditing it would write a row per person per change of a bono balance.

-- --------------------------------------------------------------- lists
create table public.patient_lists (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  -- Shared with the whole team, or seen only by its author, as segments are.
  shared boolean not null default true,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patient_lists_account_idx on public.patient_lists (account_id, name);
create index patient_lists_created_by_idx on public.patient_lists (created_by);
select public.grant_data_api('public.patient_lists');

-- The same stamp segments use: the author is whoever is signed in, and
-- neither author nor account moves on an update. The columns it touches are
-- the same on both tables.
create trigger patient_lists_stamp before insert or update on public.patient_lists
  for each row execute function public.patient_segments_stamp();

alter table public.patient_lists enable row level security;

-- Who may see and tidy a list is who may see and tidy a segment.
create policy "staff select patient_lists" on public.patient_lists for select
  using (
    account_id in (select public.my_member_account_ids())
    and (shared or (account_id, created_by) in (select * from public.my_team_member_identities()))
  );
create policy "staff insert patient_lists" on public.patient_lists for insert
  with check ((account_id, created_by) in (select * from public.my_team_member_identities()));
create policy "staff update patient_lists" on public.patient_lists for update
  using (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  )
  with check (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  );
create policy "staff delete patient_lists" on public.patient_lists for delete
  using (
    (account_id, created_by) in (select * from public.my_team_member_identities())
    or (shared and account_id in (select public.my_member_account_ids()) and public.has_permission(account_id, 'patients_edit'))
  );
select public.require_two_factor_on('public.patient_lists');

-- Whoever may rename or delete a list may add people to it and take them off.
create or replace function public.can_manage_patient_list(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_lists l
    where l.id = p_list_id
      and (
        (l.account_id, l.created_by) in (select * from public.my_team_member_identities())
        or (l.shared and l.account_id in (select public.my_member_account_ids()) and public.has_permission(l.account_id, 'patients_edit'))
      )
  )
$$;
revoke all on function public.can_manage_patient_list(uuid) from public, anon;
grant execute on function public.can_manage_patient_list(uuid) to authenticated, service_role;

-- --------------------------------------------------------------- members
create table public.patient_list_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  list_id uuid not null references public.patient_lists(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references public.team_members(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'bulk', 'import')),
  -- For an import, the file it came from.
  source_detail text check (source_detail is null or length(source_detail) <= 200),
  constraint patient_list_members_once unique (list_id, patient_id)
);
create index patient_list_members_patient_idx on public.patient_list_members (patient_id);
create index patient_list_members_added_idx on public.patient_list_members (list_id, added_at);
create index patient_list_members_added_by_idx on public.patient_list_members (added_by);
create index patient_list_members_account_idx on public.patient_list_members (account_id);
select public.grant_data_api('public.patient_list_members');

-- The account is the list's and the author whoever is signed in, whatever the
-- client sent; and the patient has to be the same account's, so a list can
-- never carry somebody else's patient.
create or replace function public.patient_list_members_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select l.account_id into new.account_id from public.patient_lists l where l.id = new.list_id;
  if not exists (select 1 from public.patients p where p.id = new.patient_id and p.account_id = new.account_id) then
    raise exception 'The patient and the list belong to different accounts' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.added_by := coalesce(
      (select i.team_member_id from public.my_team_member_identities() i where i.account_id = new.account_id limit 1),
      new.added_by
    );
  end if;
  return new;
end;
$$;
revoke all on function public.patient_list_members_stamp() from public, anon, authenticated;
create trigger patient_list_members_stamp before insert or update on public.patient_list_members
  for each row execute function public.patient_list_members_stamp();

alter table public.patient_list_members enable row level security;

-- Seen when both the list and the patient are: a practitioner who sees only
-- their own patients sees only those of a shared list's members.
create policy "staff select patient_list_members" on public.patient_list_members for select
  using (
    list_id in (select l.id from public.patient_lists l)
    and public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
  );
create policy "staff insert patient_list_members" on public.patient_list_members for insert
  with check (public.can_manage_patient_list(list_id) and public.can_access_patient(account_id, patient_id));
create policy "staff delete patient_list_members" on public.patient_list_members for delete
  using (public.can_manage_patient_list(list_id) and public.can_access_patient(account_id, patient_id));
select public.require_two_factor_on('public.patient_list_members');

-- --------------------------------------------------------------- segment membership
create table public.patient_segment_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  segment_id uuid not null references public.patient_segments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  entered_at timestamptz not null default now(),
  -- Null while they are in it.
  left_at timestamptz
);
-- In a segment at most once at a time; every past stay is its own row.
create unique index patient_segment_members_current_idx on public.patient_segment_members (segment_id, patient_id) where left_at is null;
create index patient_segment_members_entered_idx on public.patient_segment_members (segment_id, entered_at);
create index patient_segment_members_patient_idx on public.patient_segment_members (patient_id);
create index patient_segment_members_account_idx on public.patient_segment_members (account_id);
select public.grant_data_api('public.patient_segment_members');

alter table public.patient_segment_members enable row level security;

-- Read-only to staff, and only for a segment they can see and a patient they
-- may see. Only refresh_segment_members() writes it.
create policy "staff select patient_segment_members" on public.patient_segment_members for select
  using (
    segment_id in (select s.id from public.patient_segments s)
    and public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id)
  );
select public.require_two_factor_on('public.patient_segment_members');

-- --------------------------------------------------------------- audit
-- Adds the two types to whatever the constraint allows when this runs, the
-- way 20261022173310 does, rather than restating a list other branches are
-- adding to.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['patient_list', 'patient_list_member']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_patient_lists after insert or update or delete on public.patient_lists
  for each row execute function public.fn_audit_log('patient_list', 'updated_at');
create trigger trg_audit_patient_list_members after insert or update or delete on public.patient_list_members
  for each row execute function public.fn_audit_log('patient_list_member');

-- --------------------------------------------------------------- anonymisation
-- Anonymising a record takes it off every list and out of every segment's
-- history, the way patient_relations goes (20261021171628).
create or replace function public.patients_drop_audiences_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_list_members where patient_id = new.id;
    delete from public.patient_segment_members where patient_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.patients_drop_audiences_on_anonymize() from public, anon, authenticated;
create trigger patients_drop_audiences_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_audiences_on_anonymize();

-- --------------------------------------------------------------- the rule engine
-- patients_matching, restated from 20261022173310 with five keys added and
-- nothing else changed:
--
--   list        uuid: on this list
--   notList     uuid: not on this list
--   family      'linked' | 'none' | 'parent' | 'child' | 'partner' | 'sibling'
--   familyBono  true: shares a bono with someone (either way round)
--   marketing   'email' | 'whatsapp' | 'any' | 'none': accepted marketing by
--
-- Unknown keys are still ignored, so an older app and this database, or this
-- app and an older database, keep working with each other.
create or replace function public.patients_matching(p_filters jsonb default '{}'::jsonb, p_clinic_id uuid default null)
returns setof public.patients
language plpgsql
stable
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  w text[] := array[]::text[];
  v_status text := coalesce(nullif(f->>'status', ''), 'active');
  v_clinic text := nullif(f->>'clinic', '');
  v_clinic_id uuid;
  v_tz text;
  v_tags text[];
  v_token text;
  v_like text;
  v_last_visit text := '(select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status = ''completed'' and a.deleted_at is null)';
  v_bono_left text := '(select coalesce(sum(pp.sessions_total - pp.sessions_used), 0) from package_purchases pp'
    || ' where not pp.is_closed and pp.sessions_used < pp.sessions_total'
    || ' and pp.id in (select o.id from package_purchases o where o.patient_id = p.id'
    || ' union all select s.package_purchase_id from package_purchase_shares s where s.patient_id = p.id))';
begin
  -- Which clinic. The sidebar's clinic unless the filter names another, or
  -- 'all' for every clinic the person can see.
  if v_clinic is null then
    v_clinic_id := p_clinic_id;
  elsif v_clinic <> 'all' then
    v_clinic_id := v_clinic::uuid;
  end if;
  if v_clinic_id is not null then
    w := w || format('p.clinic_id = %L', v_clinic_id);
  end if;
  select c.timezone into v_tz from clinics c where c.id = coalesce(v_clinic_id, p_clinic_id);
  v_tz := coalesce(nullif(v_tz, ''), 'Europe/Madrid');

  if v_status in ('active', 'inactive') then
    w := w || format('p.status = %L', v_status);
  end if;

  if nullif(f->>'practitioner', '') is not null then
    w := w || format('p.default_practitioner_id = %L', (f->>'practitioner')::uuid);
  end if;

  if jsonb_typeof(f->'tags') = 'array' then
    select array_agg(t) into v_tags from jsonb_array_elements_text(f->'tags') t where t <> '';
    if v_tags is not null then
      w := w || format('p.tags @> %L::text[]', v_tags);
    end if;
  end if;

  if nullif(f->>'lastVisitFrom', '') is not null then
    w := w || format('%s >= (%L::date)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitFrom')::date, v_tz);
  end if;
  if nullif(f->>'lastVisitTo', '') is not null then
    w := w || format('%s < ((%L::date) + 1)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitTo')::date, v_tz);
  end if;

  -- Same definition as the list's Next visit column (patient_list_visit_summary).
  if f->>'futureAppointment' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from appointments a where a.patient_id = p.id and a.status = ''booked'' and a.starts_at > now() and a.deleted_at is null)',
      case when f->>'futureAppointment' = 'no' then 'not' else '' end
    );
  end if;

  -- A live bono is what the Billing tab offers sessions from: own or shared,
  -- not closed in PracticeHub (20260923120702), with sessions left.
  if f->>'bono' = 'active' then
    w := w || format('%s > 0', v_bono_left);
    if nullif(f->>'bonoSessionsMax', '') is not null then
      w := w || format('%s <= %s', v_bono_left, greatest((f->>'bonoSessionsMax')::int, 0));
    end if;
  elsif f->>'bono' = 'none' then
    w := w || format('%s = 0', v_bono_left);
  end if;

  -- Owing asks the invoices, In credit the balance -- two different columns
  -- on purpose; see 20260923160000 and utils/owing.ts. Read from the view as
  -- one set, not through live_outstanding_cents(p) per row: on 3,300
  -- patients the computed field took 7.6 s (the view recomputed once per
  -- patient) and the set 80 ms. Same view, same RLS, same numbers.
  if f->>'balance' = 'owing' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.outstanding_cents > 0)'::text;
  elsif f->>'balance' = 'credit' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.balance_cents > 0)'::text;
  end if;

  if nullif(f->>'createdFrom', '') is not null then
    w := w || format('p.created_at >= (%L::date)::timestamp at time zone %L', (f->>'createdFrom')::date, v_tz);
  end if;
  if nullif(f->>'createdTo', '') is not null then
    w := w || format('p.created_at < ((%L::date) + 1)::timestamp at time zone %L', (f->>'createdTo')::date, v_tz);
  end if;

  -- What the patient banner calls "has the app" (components/patients/AppStatus.vue).
  if f->>'app' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from app_opens o where o.account_id = p.account_id and o.user_id = p.user_id)',
      case when f->>'app' = 'no' then 'not' else '' end
    );
  end if;

  if f->>'birthdayThisMonth' = 'true' then
    w := w || format('extract(month from p.date_of_birth) = extract(month from now() at time zone %L)', v_tz);
  end if;

  if f->>'carePlan' = 'on' then
    w := w || 'exists (select 1 from care_plans cp where cp.patient_id = p.id)'::text;
  end if;

  if f->>'missingContact' = 'email' then
    w := w || '(p.email is null or p.email = '''')'::text;
  elsif f->>'missingContact' = 'phone' then
    w := w || 'not p.has_phone'::text;
  end if;

  if f->>'doNotContact' = 'true' then
    w := w || 'p.do_not_contact'::text;
  end if;
  if f->>'minors' = 'true' then
    w := w || 'p.is_minor'::text;
  end if;

  -- On a list, or not on one (patient_list_members). Read under the caller's
  -- RLS like everything else here, so a private list someone else made
  -- matches nobody rather than leaking who is on it.
  if nullif(f->>'list', '') is not null then
    w := w || format('p.id in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'list')::uuid);
  end if;
  if nullif(f->>'notList', '') is not null then
    w := w || format('p.id not in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'notList')::uuid);
  end if;

  -- Family on the record (patient_relations, 20261021171628). 'linked' is
  -- anyone at all, 'none' nobody; a relation names what the OTHER person is
  -- to this one, as the table reads -- 'child' is "has a child on file",
  -- which is how a segment of parents is asked for.
  if f->>'family' = 'linked' then
    w := w || 'exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' = 'none' then
    w := w || 'not exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' in ('parent', 'child', 'partner', 'sibling') then
    w := w || format('exists (select 1 from patient_relations r where r.patient_id = p.id and r.relation = %L)', f->>'family');
  end if;

  -- Shares a bono with somebody, either way round: the bono-sharing graph
  -- that pools a family's money (package_share_edges, 20260923165911).
  if f->>'familyBono' = 'true' then
    w := w || 'exists (select 1 from package_share_edges e where e.a = p.id)'::text;
  end if;

  -- Marketing consent as stored: a channel present in marketing_channels.
  -- A withdrawn channel is its absence (20260930141326).
  if f->>'marketing' in ('email', 'whatsapp') then
    w := w || format('%L = any (p.marketing_channels)', f->>'marketing');
  elsif f->>'marketing' = 'any' then
    w := w || 'cardinality(p.marketing_channels) > 0'::text;
  elsif f->>'marketing' = 'none' then
    w := w || 'cardinality(p.marketing_channels) = 0'::text;
  end if;

  -- Every word must match one of the four, as the list's search always has.
  -- LIKE's own wildcards and escape are taken out of what was typed.
  for v_token in
    select regexp_replace(x, '[%_\\,()]', '', 'g') from regexp_split_to_table(btrim(coalesce(f->>'q', '')), '\s+') x
  loop
    continue when v_token = '';
    v_like := '%' || v_token || '%';
    w := w || format(
      '(p.search_name ilike %L or p.email ilike %L or p.national_id ilike %L or p.phone_search ilike %L)',
      '%' || unaccent_lower(v_token) || '%', v_like, v_like, v_like
    );
  end loop;

  return query execute 'select p.* from patients p where '
    || coalesce(nullif(array_to_string(w, ' and '), ''), 'true');
end;
$$;

revoke all on function public.patients_matching(jsonb, uuid) from public, anon;
grant execute on function public.patients_matching(jsonb, uuid) to authenticated, service_role;

-- --------------------------------------------------------------- list counts
-- Every list the caller can see, with how many patients opening it shows
-- right now and how many of them accept marketing by each channel. Opening a
-- list is the patient list filtered to it in every clinic ({list, clinic:
-- 'all'}): a list is the people put on it, wherever they are seen. Counted
-- by patients_matching, so the number beside a list is the number of rows.
create or replace function public.patient_list_counts()
returns table (list_id uuid, patient_count bigint, email_count bigint, whatsapp_count bigint)
language sql
stable
set search_path = public
as $$
  select l.id,
         count(m.id),
         count(m.id) filter (where 'email' = any (m.marketing_channels)),
         count(m.id) filter (where 'whatsapp' = any (m.marketing_channels))
  from public.patient_lists l
  left join lateral public.patients_matching(jsonb_build_object('list', l.id, 'clinic', 'all'), null) m on m.account_id = l.account_id
  group by l.id
$$;
revoke all on function public.patient_list_counts() from public, anon;
grant execute on function public.patient_list_counts() to authenticated, service_role;

-- --------------------------------------------------------------- bulk add / remove
-- "Add all 1,240 matching to a list" without sending 1,240 ids from the
-- browser: the same filters the table was showing, evaluated here. Security
-- invoker, so the insert policy decides per row exactly as for a single add.
-- Returns how many were added (people already on it are left as they were).
create or replace function public.add_matching_to_patient_list(p_list_id uuid, p_filters jsonb, p_clinic_id uuid default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_account uuid;
  v_count integer;
begin
  select l.account_id into v_account from patient_lists l where l.id = p_list_id;
  if v_account is null then
    raise exception 'List not found' using errcode = 'no_data_found';
  end if;
  insert into patient_list_members (account_id, list_id, patient_id, source)
  select v_account, p_list_id, m.id, 'bulk'
  from patients_matching(p_filters, p_clinic_id) m
  where m.account_id = v_account
  on conflict (list_id, patient_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.add_matching_to_patient_list(uuid, jsonb, uuid) from public, anon;
grant execute on function public.add_matching_to_patient_list(uuid, jsonb, uuid) to authenticated, service_role;

create or replace function public.remove_matching_from_patient_list(p_list_id uuid, p_filters jsonb, p_clinic_id uuid default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from patient_list_members lm
  where lm.list_id = p_list_id
    and lm.patient_id in (select m.id from patients_matching(p_filters, p_clinic_id) m);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.remove_matching_from_patient_list(uuid, jsonb, uuid) from public, anon;
grant execute on function public.remove_matching_from_patient_list(uuid, jsonb, uuid) to authenticated, service_role;

-- --------------------------------------------------------------- segment snapshot
-- Brings patient_segment_members up to date with what patients_matching says
-- now: whoever matches and is not in gets a row (entered), whoever is in and
-- no longer matches has it closed (left). One segment, or every one.
--
-- Evaluated for the whole account, not one clinic: a segment that names no
-- clinic is "the sidebar's clinic" on the Patients page, which an automation
-- has no sidebar to ask. For a clinic with one location the two are the same.
--
-- Security definer, because the snapshot is the clinic's and not the
-- caller's: a practitioner scoped to their own patients must not shrink a
-- shared segment to their own patients by saving it. So it reads everything,
-- and is careful about who may ask: a signed-in caller only for segments of
-- their own accounts; with no auth.uid() (pg_cron, the service role) any.
create or replace function public.refresh_segment_members(p_segment_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_ids uuid[];
  v_changed integer := 0;
  v_count integer;
begin
  for s in
    select ps.id, ps.account_id, ps.filters from patient_segments ps
    where (p_segment_id is null or ps.id = p_segment_id)
      and (auth.uid() is null or ps.account_id in (select my_member_account_ids()))
  loop
    select coalesce(array_agg(m.id), '{}') into v_ids
    from patients_matching(s.filters, null) m
    where m.account_id = s.account_id;

    update patient_segment_members sm set left_at = now()
    where sm.segment_id = s.id and sm.left_at is null and not (sm.patient_id = any (v_ids));
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;

    insert into patient_segment_members (account_id, segment_id, patient_id)
    select s.account_id, s.id, x
    from unnest(v_ids) x
    where not exists (
      select 1 from patient_segment_members sm where sm.segment_id = s.id and sm.patient_id = x and sm.left_at is null
    );
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;
  end loop;

  -- Past stays are kept for as long as an automation could still be catching
  -- up on them, then let go.
  if p_segment_id is null and auth.uid() is null then
    delete from patient_segment_members where left_at < now() - interval '180 days';
  end if;

  return v_changed;
end;
$$;
revoke all on function public.refresh_segment_members(uuid) from public, anon;
grant execute on function public.refresh_segment_members(uuid) to authenticated, service_role;

-- A segment's membership is current the moment it is saved, not up to
-- fifteen minutes later: a new segment, or new rules on an old one.
create or replace function public.patient_segments_refresh_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.filters is distinct from old.filters then
    perform refresh_segment_members(new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.patient_segments_refresh_members() from public, anon, authenticated;
create trigger patient_segments_refresh_members after insert or update of filters on public.patient_segments
  for each row execute function public.patient_segments_refresh_members();

-- Segments saved before this migration start with their members as of now.
select public.refresh_segment_members();

-- Every fifteen minutes, everywhere. A plain SQL call -- no deployment URL,
-- no secret -- so it belongs in a migration like 0153's prune job, and runs
-- locally and in CI the same. Off the :00/:15 marks the HTTP crons use.
do $$
begin
  perform cron.unschedule('refresh-segment-members');
exception when others then
  null;
end $$;
select cron.schedule('refresh-segment-members', '7,22,37,52 * * * *', $$select public.refresh_segment_members()$$);

-- --------------------------------------------------------------- for the automation engine
-- What a campaign or an automation aimed at an audience reads. kind is
-- 'list' or 'segment'; id the patient_lists or patient_segments row.
--
-- Security invoker: the engine calls these with the service role and sees
-- everyone; a signed-in member sees what RLS lets them. Neither applies any
-- consent or status rule -- the engine's own gates do, as for every audience
-- (not archived, not a minor, not do_not_contact, a marketing channel for a
-- marketing rule).

-- Who is in it now.
create or replace function public.audience_members(p_kind text, p_id uuid)
returns table (patient_id uuid, entered_at timestamptz)
language sql
stable
set search_path = public
as $$
  select lm.patient_id, lm.added_at from patient_list_members lm
  where p_kind = 'list' and lm.list_id = p_id
  union all
  select sm.patient_id, sm.entered_at from patient_segment_members sm
  where p_kind = 'segment' and sm.segment_id = p_id and sm.left_at is null
$$;
revoke all on function public.audience_members(text, uuid) from public, anon;
grant execute on function public.audience_members(text, uuid) to authenticated, service_role;

-- Who came in after p_since, oldest first: the "entered" trigger's feed. A
-- segment stay counts even if it has already ended -- someone who matched
-- for an afternoon did enter. Someone who left and came back appears again,
-- at the later time; whether that starts a second run is the rule's
-- entry_mode, not this function's business.
create or replace function public.audience_entries_since(p_kind text, p_id uuid, p_since timestamptz)
returns table (patient_id uuid, entered_at timestamptz)
language sql
stable
set search_path = public
as $$
  select x.patient_id, x.entered_at from (
    select lm.patient_id, lm.added_at as entered_at from patient_list_members lm
    where p_kind = 'list' and lm.list_id = p_id and lm.added_at > p_since
    union all
    select sm.patient_id, sm.entered_at from patient_segment_members sm
    where p_kind = 'segment' and sm.segment_id = p_id and sm.entered_at > p_since
  ) x
  order by x.entered_at, x.patient_id
$$;
revoke all on function public.audience_entries_since(text, uuid, timestamptz) from public, anon;
grant execute on function public.audience_entries_since(text, uuid, timestamptz) to authenticated, service_role;

-- --------------------------------------------------------------- merge_patients
-- merge_patients moves them (CLAUDE.md). Restated from main's latest
-- definition (20261023093754_third_party_payers) with the two audience blocks
-- added after the custom fields and nothing else changed.
create or replace function merge_patients(p_survivor_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_dup_account_id uuid;
  v_moved jsonb := '{}'::jsonb;
  v_count int;
  v_dup_external_reference text;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'Cannot merge a patient into itself';
  end if;

  select account_id into v_account_id from patients where id = p_survivor_id;
  select account_id into v_dup_account_id from patients where id = p_duplicate_id;

  if v_account_id is null or v_dup_account_id is null then
    raise exception 'Both patients must exist';
  end if;
  -- Never merge across accounts: that would move one clinic's clinical and
  -- financial records into another's.
  if v_account_id <> v_dup_account_id then
    raise exception 'Both patients must belong to the same account';
  end if;
  if not is_account_member(v_account_id) then
    raise exception 'Not a member of this account';
  end if;
  if not has_permission(v_account_id, 'patients_delete_merge') then
    raise exception 'Missing permission: patients_delete_merge';
  end if;

  -- Ownership of bonos moves first, so the share cleanup below can see which
  -- bonos the survivor ends up owning.
  update package_purchases set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchases', v_count);

  -- `package_purchase_shares` is unique on (package_purchase_id, patient_id),
  -- and two rows of the duplicate's would now violate it or be meaningless:
  -- a bono the survivor already shares, and a bono the survivor now owns
  -- outright (you do not share a bono with yourself). Drop those, move the
  -- rest.
  delete from package_purchase_shares s
  where s.patient_id = p_duplicate_id
    and (
      exists (select 1 from package_purchase_shares o
               where o.package_purchase_id = s.package_purchase_id and o.patient_id = p_survivor_id)
      or exists (select 1 from package_purchases pp
                  where pp.id = s.package_purchase_id and pp.patient_id = p_survivor_id)
    );
  update package_purchase_shares set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchase_shares', v_count);

  -- Stripe allows one customer per patient per account. If the survivor
  -- already has one, keep it -- it is the one any saved card and active
  -- payment schedule is attached to -- and let the duplicate's row go.
  if exists (select 1 from patient_stripe_customers where patient_id = p_survivor_id and account_id = v_account_id) then
    delete from patient_stripe_customers where patient_id = p_duplicate_id;
  else
    update patient_stripe_customers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  end if;

  update account_credits set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('account_credits', v_count);

  update appointments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('appointments', v_count);

  update invoices set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('invoices', v_count);

  -- The money itself. `payments.patient_id` is `on delete cascade`, so before
  -- this line the delete at the end of the function destroyed every payment
  -- the duplicate held -- silently, and after reporting the merge a success.
  update payments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('payments', v_count);

  -- Facturas follow their payments onto the survivor. No huella is affected:
  -- the patient is not one of the hashed fields, and factura_records is keyed
  -- by factura, not by patient.
  update facturas set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas', v_count);

  update package_sessions set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_sessions', v_count);

  update care_plans set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_exercises set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_push_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update contact_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_app_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_contact_numbers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_memberships set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update payment_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update photo_upload_tokens set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update waitlist_entries set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update whatsapp_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- Automation runs follow the person: a patient halfway through a follow-up
  -- sequence carries on from where they were, on the surviving record, rather
  -- than having the run (and its history) cascade away with the duplicate.
  update automation_sequence_runs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('automation_sequence_runs', v_count);

  -- Mi día tasks an automation left about this person stay with the person.
  update staff_tasks set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('staff_tasks', v_count);

  -- The birthday guard is unique per (rule, patient, day). A day both records
  -- were already greeted on keeps the survivor's row; the rest move, so a
  -- merge on someone's birthday does not greet them a second time.
  delete from automation_birthday_sends d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from automation_birthday_sends s
                  where s.patient_id = p_survivor_id and s.rule_id = d.rule_id and s.local_date = d.local_date);
  update automation_birthday_sends set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- These three are `on delete set null`, so they outlive the duplicate
  -- either way -- but with the link to the person cut. A lead that converted
  -- would stop knowing which patient it became, and a review request would
  -- stop knowing who it was sent to. Same reasoning as whatsapp_messages
  -- above, which has always been moved despite being set null too.
  update email_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update leads set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update review_requests set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  update patient_docs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_docs', v_count);

  update patient_files set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_files', v_count);

  -- Letters (patient_letters, 20261022185121) arrive in their own branch,
  -- which restates this function too; named only once the table exists, so
  -- whichever of the two applies second keeps both.
  if to_regclass('public.patient_letters') is not null then
    execute 'update public.patient_letters set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('patient_letters', v_count);
  end if;

  update posture_assessments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('posture_assessments', v_count);

  -- learn_sends arrives in its own migration, which redefines this function
  -- too; whichever lands second keeps both by naming the other's table only
  -- once it exists.
  if to_regclass('public.learn_sends') is not null then
    execute 'update public.learn_sends set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('learn_sends', v_count);
  end if;

  -- Other patients pointing AT the duplicate -- a child whose tutor is the
  -- duplicate record, someone the duplicate referred. These FKs are
  -- `on delete set null`, so leaving them would silently orphan a minor's
  -- tutor link. Repoint them, except where that would make the survivor its
  -- own tutor or its own referrer.
  update patients set tutor_patient_id = p_survivor_id
   where tutor_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set tutor_patient_id = null
   where id = p_survivor_id and tutor_patient_id = p_duplicate_id;
  update patients set referred_by_patient_id = p_survivor_id
   where referred_by_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set referred_by_patient_id = null
   where id = p_survivor_id and referred_by_patient_id = p_duplicate_id;

  -- Family links (patient_relations, 20261021171628), stored both ways. The
  -- duplicate's become the survivor's: a link between the two records
  -- themselves goes, and so does one the survivor already has to the same
  -- person, which the unique pair would refuse.
  delete from patient_relations
   where (patient_id = p_duplicate_id and related_patient_id = p_survivor_id)
      or (patient_id = p_survivor_id and related_patient_id = p_duplicate_id);
  delete from patient_relations d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.patient_id = p_survivor_id and s.related_patient_id = d.related_patient_id);
  delete from patient_relations d
   where d.related_patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.related_patient_id = p_survivor_id and s.patient_id = d.patient_id);
  update patient_relations set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_relations', v_count);
  update patient_relations set related_patient_id = p_survivor_id where related_patient_id = p_duplicate_id;

  -- Facturas addressed to the duplicate as a minor's tutor (recipient_patient_id,
  -- 20261021173018) are addressed to the survivor. Not a foreign key, so
  -- nothing would have stopped the delete below from leaving them pointing at
  -- a record that no longer exists.
  update facturas set recipient_patient_id = p_survivor_id where recipient_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas_addressed', v_count);

  -- Third-party cover and what third parties owe for the duplicate's visits
  -- (20261023093754). The charges are RESTRICT, so leaving them here would
  -- fail the delete below rather than lose them; the cover would cascade.
  update patient_third_parties set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_third_parties', v_count);
  update third_party_charges set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('third_party_charges', v_count);

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's.
  update patient_care_stops set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_care_stops', v_count);

  -- Who follows up the patient on Recalls (recall_assignments,
  -- 20261022185125): one row per patient, so of the two records' choices
  -- the more recent one is kept and becomes the survivor's.
  delete from recall_assignments d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from recall_assignments s where s.patient_id = p_survivor_id and s.assigned_at >= d.assigned_at);
  delete from recall_assignments s
   where s.patient_id = p_survivor_id
     and exists (select 1 from recall_assignments d where d.patient_id = p_duplicate_id);
  update recall_assignments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('recall_assignments', v_count);

  -- Custom fields (patient_attribute_values, 20261023053614), one answer per
  -- patient and field. As for the columns below, the survivor keeps the
  -- answers it already has and only its blanks are filled from the
  -- duplicate's.
  delete from patient_attribute_values d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_attribute_values s where s.patient_id = p_survivor_id and s.attribute_id = d.attribute_id);
  update patient_attribute_values set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_attribute_values', v_count);

  -- Lists (patient_list_members, this migration): the survivor is on every
  -- list either record was on. Where both were, the survivor's own entry is
  -- kept -- it is the earlier added_at only by accident, but it is the one
  -- an automation may already have acted on.
  delete from patient_list_members d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_list_members s where s.patient_id = p_survivor_id and s.list_id = d.list_id);
  update patient_list_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_list_members', v_count);

  -- Segment stays (patient_segment_members): the history moves, except a
  -- current stay where the survivor has one of its own, which would be two
  -- at once. The next refresh settles whether the merged record still
  -- matches.
  delete from patient_segment_members d
   where d.patient_id = p_duplicate_id and d.left_at is null
     and exists (select 1 from patient_segment_members s where s.patient_id = p_survivor_id and s.segment_id = d.segment_id and s.left_at is null);
  update patient_segment_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_segment_members', v_count);

  -- external_reference is unique per account (patients_external_reference_uniq)
  -- and the duplicate is only deleted at the end, so copying its reference
  -- onto the survivor below collided with the duplicate's own copy. That is
  -- the commonest pair there is -- a record made at the front desk and the
  -- PracticeHub import of the same person -- and the merge refused it with
  -- "duplicate key value". Take the reference off the duplicate first; the
  -- field merge reads it from here instead.
  select external_reference into v_dup_external_reference from patients where id = p_duplicate_id;
  if v_dup_external_reference is not null then
    update patients set external_reference = null where id = p_duplicate_id;
  end if;

  -- Field-level merge: the survivor keeps everything it already has, and only
  -- its blanks are filled from the duplicate. That is the direction that can
  -- never lose data the front desk deliberately typed -- picking the
  -- duplicate's value over a populated one would.
  --
  -- Arrays are unioned rather than replaced: a VIP tag or a marketing opt-in
  -- on either record belongs to the person, not to the row.
  --
  -- balance_cents is summed. It is not a live ledger -- it is the account
  -- balance written once at PracticeHub import (patient_live_balances is the
  -- computed one) -- so for two halves of one person the snapshot is the sum.
  update patients s set
    last_name              = coalesce(nullif(s.last_name, ''), d.last_name),
    date_of_birth          = coalesce(s.date_of_birth, d.date_of_birth),
    email                  = coalesce(nullif(s.email, ''), d.email),
    occupation             = coalesce(nullif(s.occupation, ''), d.occupation),
    emergency_contact      = coalesce(nullif(s.emergency_contact, ''), d.emergency_contact),
    referral_source        = coalesce(nullif(s.referral_source, ''), d.referral_source),
    notes                  = coalesce(nullif(s.notes, ''), d.notes),
    external_reference     = coalesce(nullif(s.external_reference, ''), v_dup_external_reference),
    address                = coalesce(nullif(s.address, ''), d.address),
    national_id            = coalesce(nullif(s.national_id, ''), d.national_id),
    sticky_note            = coalesce(nullif(s.sticky_note, ''), d.sticky_note),
    gender                 = coalesce(nullif(s.gender, ''), d.gender),
    chief_complaint        = coalesce(nullif(s.chief_complaint, ''), d.chief_complaint),
    red_flags              = coalesce(nullif(s.red_flags, ''), d.red_flags),
    yellow_flags           = coalesce(nullif(s.yellow_flags, ''), d.yellow_flags),
    diagnosis              = coalesce(nullif(s.diagnosis, ''), d.diagnosis),
    goals                  = coalesce(nullif(s.goals, ''), d.goals),
    postal_code            = coalesce(nullif(s.postal_code, ''), d.postal_code),
    city                   = coalesce(nullif(s.city, ''), d.city),
    country                = coalesce(nullif(s.country, ''), d.country),
    photo_storage_path     = coalesce(nullif(s.photo_storage_path, ''), d.photo_storage_path),
    clinic_id              = coalesce(s.clinic_id, d.clinic_id),
    default_practitioner_id = coalesce(s.default_practitioner_id, d.default_practitioner_id),
    user_id                = coalesce(s.user_id, d.user_id),
    tags                   = (select coalesce(array_agg(distinct x), '{}') from unnest(s.tags || d.tags) x),
    marketing_channels     = (select coalesce(array_agg(distinct x), '{}') from unnest(s.marketing_channels || d.marketing_channels) x),
    -- Who may be contacted, and through whom, belongs to the person: if
    -- either record says minor, the merged one does, and keeps the tutor its
    -- messages go to. Before this a child flagged minor on the record that
    -- was deleted became directly contactable. Never the patient's own tutor
    -- or referrer: the duplicate may point at the survivor.
    is_minor               = s.is_minor or d.is_minor,
    tutor_patient_id       = coalesce(s.tutor_patient_id,
                                      nullif(nullif(d.tutor_patient_id, p_survivor_id), p_duplicate_id)),
    referred_by_patient_id = coalesce(s.referred_by_patient_id,
                                      nullif(nullif(d.referred_by_patient_id, p_survivor_id), p_duplicate_id)),
    app_push_opted_out     = s.app_push_opted_out or d.app_push_opted_out,
    has_phone              = s.has_phone or d.has_phone,
    do_not_contact         = s.do_not_contact or d.do_not_contact,
    balance_cents          = s.balance_cents + d.balance_cents
  from patients d
  where s.id = p_survivor_id and d.id = p_duplicate_id;

  -- Every table keyed off the duplicate has been moved above, so the cascade
  -- has nothing left to take. That sentence was already here and was wrong
  -- for payments; the guard below is what makes it checkable rather than
  -- merely intended.
  --
  -- A table added to `patients` in future and forgotten here lands in exactly
  -- the same trap, and the next one may be as quiet as payments was. RESTRICT
  -- on facturas turns the fiscal case into a loud failure; this turns the
  -- money case into one too, at the cost of one count.
  if exists (select 1 from payments where patient_id = p_duplicate_id) then
    raise exception 'merge_patients would have deleted payments still on the duplicate record (patient %)', p_duplicate_id
      using errcode = 'restrict_violation';
  end if;

  delete from patients where id = p_duplicate_id;

  return v_moved;
end;
$$;
