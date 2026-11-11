-- Four things that cost more with every clinic added, none of which shows on
-- a database with one clinic in it.
--
-- 1. Row-level-security policies that test membership ONE ROW AT A TIME.
--
--    `is_account_member(account_id)` and `has_permission(account_id, 'x')`
--    are functions of the row, so Postgres cannot use them to choose rows: it
--    reads every row of every clinic and calls them on each. Measured on
--    production, 11 Nov 2026, as an owner of the largest account, for the
--    Retention report's read of contact_log:
--
--        Seq Scan on contact_log (actual rows=18654)
--          Rows Removed by Filter: 24908        <- other clinics' rows
--          Buffers: shared hit=125130
--        Execution Time: 1207 ms                 (3.7 s under load, x19 pages)
--
--    The set-based form, `account_id in (select my_member_account_ids())`,
--    is evaluated once and lets the planner go straight to the caller's rows
--    through the account_id index. appointments, patients, invoices, payments
--    and whatsapp_messages were rewritten that way in 0142-0144; 195 policies
--    on 112 tables were not, and every migration since has been written in
--    the per-row form because it is the one that reads naturally.
--
--    The rewrite is mechanical and exact:
--
--        is_account_member(account_id)
--          == account_id in (select my_member_account_ids())
--        has_permission(account_id, 'x')
--          == account_id in (select my_permitted_accounts('x'))
--
--    Both pairs read the same team_members rows with the same conditions
--    (my_permitted_accounts is literally has_permission over the caller's
--    memberships), and account_id is NOT NULL on every table involved, so
--    there is no three-valued-logic gap. Calls under a NOT are left alone,
--    as are WITH CHECK expressions (one row, nothing to scan) and calls on
--    anything other than the table's own account_id.
--
--    Done from the catalog rather than as 195 hand-copied statements so that
--    it rewrites what is actually there, including policies added by
--    migrations that merge between this being written and being applied.
do $$
declare
  r record;
  v_new text;
  v_count integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname = 'public' and qual is not null
      and qual ~ '(is_account_member\(account_id\)|has_permission\(account_id, ''[a-z_]+''::text\))'
  loop
    v_new := regexp_replace(
      regexp_replace(r.qual,
        '(?<!NOT )(?<!NOT \()is_account_member\(account_id\)',
        '(account_id IN ( SELECT my_member_account_ids()))', 'g'),
      '(?<!NOT )(?<!NOT \()has_permission\(account_id, (''[a-z_]+'')::text\)',
      '(account_id IN ( SELECT my_permitted_accounts(\1)))', 'g');
    if v_new is distinct from r.qual then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_new);
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice 'tenant-scoped policies: % rewritten', v_count;
end $$;

-- The rewrite only helps where there is an index to go to. Eleven small
-- tables keyed by account had none leading on account_id.
do $$
declare
  t record;
begin
  for t in
    select distinct p.tablename
    from pg_policies p
    join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'account_id'
    where p.schemaname = 'public'
      and p.qual ~ 'account_id IN \( SELECT my_(member_account_ids|permitted_accounts)'
      and not exists (
        select 1 from pg_indexes i
        where i.schemaname = 'public' and i.tablename = p.tablename and i.indexdef ~ '\(account_id[,)]'
      )
  loop
    execute format('create index if not exists %I on public.%I (account_id)', t.tablename || '_account_id_idx', t.tablename);
  end loop;
end $$;

-- 2. refresh_segment_members() read every patient in the database for every
--    segment, every fifteen minutes.
--
--    It asks `patients_matching(filters, null) m where m.account_id = ...`,
--    but patients_matching is plpgsql that builds its own query, so that
--    outer condition is applied AFTER the function has evaluated the filters
--    (last visit, bono balance, live balance: correlated subqueries per
--    patient) for every clinic's patients. A staff member calling it is
--    narrowed by RLS; pg_cron has no RLS, so the job was segments x all
--    patients, and grew with the square of the number of clinics.
--
--    patients_matching now narrows itself when the caller says which account
--    it is working for. A transaction-local setting rather than a third
--    argument: a new signature is a second overload for PostgREST to choose
--    between, and every existing caller would have to be restated. The
--    setting can only ever REMOVE rows from the result.
--
--    Patched in place, not restated: the function is 190 lines and has been
--    restated by three migrations in three weeks, so a copy made here would
--    silently undo whichever one merges next. The block fails loudly if the
--    line it expects is not there.
do $$
declare
  v_def text;
  v_old constant text := $q$return query execute 'select p.* from patients p where '$q$;
  v_new constant text := $q$if nullif(current_setting('quiroflow.matching_account', true), '') is not null then
    w := array_prepend(format('p.account_id = %L::uuid', current_setting('quiroflow.matching_account', true)), w);
  end if;

  return query execute 'select p.* from patients p where '$q$;
begin
  select pg_get_functiondef('public.patients_matching(jsonb, uuid)'::regprocedure) into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'patients_matching no longer ends the way this migration expects; restate the account narrowing by hand';
  end if;
  if position('quiroflow.matching_account' in v_def) = 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end $$;

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
    -- Tell patients_matching whose patients to read, so it reads only those.
    perform set_config('quiroflow.matching_account', s.account_id::text, true);
    select coalesce(array_agg(m.id), '{}') into v_ids
    from patients_matching(s.filters, null) m
    where m.account_id = s.account_id;
    perform set_config('quiroflow.matching_account', '', true);

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

-- 3. pg_cron keeps a row for every run of every job, for ever.
--
--    cron.job_run_details was 75 MB on 11 Nov 2026 -- a sixth of the whole
--    database -- and grows by the number of jobs, not by anything a clinic
--    does: the VeriFactu sender alone adds 1,440 rows a day. Two weeks is
--    more than anyone has ever looked back to debug a job.
--
--    This is the scheduler's own run history. It is not the clinic's audit
--    trail (audit_logs, patient_access_log, auth_events), which is kept.
do $$
begin
  perform cron.unschedule('prune-cron-run-details');
exception when others then
  null;
end $$;

select cron.schedule(
  'prune-cron-run-details',
  '40 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$
);

-- 4. The home-screen widget read pg_timezone_names on every refresh.
--
--    That view lists the time-zone directory from disk each time it is
--    queried: 578 ms mean over 2,394 calls, to validate a string that is
--    'Europe/Madrid' nearly every time. Asking Postgres to USE the zone
--    answers the same question in microseconds.
create or replace function public.is_valid_time_zone(p_time_zone text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  perform now() at time zone p_time_zone;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.is_valid_time_zone(text) from public, anon;
grant execute on function public.is_valid_time_zone(text) to authenticated, service_role;

do $$
declare
  v_def text;
  v_old constant text := 'not exists (select 1 from pg_timezone_names where name = v_tz)';
begin
  select pg_get_functiondef('public.get_home_widget(uuid, text)'::regprocedure) into v_def;
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, 'not public.is_valid_time_zone(v_tz)');
  elsif position('is_valid_time_zone' in v_def) = 0 then
    raise exception 'get_home_widget no longer validates its time zone the way this migration expects';
  end if;
end $$;
