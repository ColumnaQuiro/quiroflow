-- A new table has to be granted to the Data API by its own migration.
--
-- Until 30 Oct 2026 Supabase gave every table created in "public" to anon,
-- authenticated and service_role automatically, through the default
-- privileges it set up on the project:
--
--     postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--     authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres
--
-- From that date it stops. Tables that already exist keep their grants; a
-- table created afterwards has none, so supabase-js, PostgREST and every
-- server route and cron (service_role included) get "permission denied" on it.
-- Most of the migrations that create a table so far grant nothing and relied
-- on those defaults.
--
-- CI would not notice. supabase/seed.sql runs after the migrations and grants
-- every table in public to all three roles, so a table missing its grants
-- passes every spec and fails only in production. That is why the guard is
-- npm run check:table-grants, which reads the migration itself, rather than a
-- test.
--
-- So every migration that creates a table or view in public ends with:
--
--     select public.grant_data_api('public.my_table');
--
-- That grants authenticated and service_role what they had by default.
-- anon only when asked for, with_anon => true: by default it could read and
-- write every table, held back by RLS alone, and a new table rarely has any
-- reason to be reachable without signing in. Sequences the table owns (an
-- identity or serial column) get usage too, or inserting through the API
-- fails on the sequence instead of the table.
--
-- A narrower grant than this -- a view that is only ever read -- is fine
-- written out by hand; the check accepts explicit grants to authenticated
-- and service_role just as well.
create or replace function public.grant_data_api(target regclass, with_anon boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  roles text := case when with_anon then 'anon, authenticated' else 'authenticated' end;
  seq record;
begin
  execute format('grant select, insert, update, delete on %s to %s', target, roles);
  execute format('grant all on %s to service_role', target);

  for seq in
    select d.objid::regclass as s
    from pg_depend d
    join pg_class c on c.oid = d.objid and c.relkind = 'S'
    where d.refobjid = target and d.deptype in ('a', 'i')
  loop
    execute format('grant usage, select on sequence %s to %s', seq.s, roles);
    execute format('grant all on sequence %s to service_role', seq.s);
  end loop;
end;
$$;

-- Only migrations call it. It is not security definer, so a member calling
-- it could not grant anything they do not own anyway; this keeps it off the
-- API altogether, the way require_two_factor_on is.
revoke all on function public.grant_data_api(regclass, boolean) from public, anon, authenticated;
