-- What the Supabase project itself has left, for the ops alerts and the admin
-- panel's Platform page. server/utils/supabaseUsage.ts combines this with the
-- project's Prometheus endpoint (CPU, memory, disk) and records the result in
-- platform_status as 'supabase.usage'.
--
-- The part only SQL can answer: storage per bucket (the Pro plan includes
-- 100 GB, and patient files are nearly all of it), and client connections
-- against max_connections, which is fixed by the compute size and does not
-- grow with the number of clinics.
--
-- Security definer because storage.objects and other sessions' rows in
-- pg_stat_activity are not the service role's to read through PostgREST.
-- It returns totals only -- no object names, no query text.
create or replace function public.platform_supabase_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_catalog.pg_stat_activity where backend_type = 'client backend'),
    'max_connections', current_setting('max_connections')::int,
    'buckets', coalesce((
      select jsonb_agg(b order by b.bytes desc)
      from (
        select bucket_id as bucket, count(*) as objects, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
        from storage.objects
        group by bucket_id
      ) b
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.platform_supabase_usage() from public, anon, authenticated;
grant execute on function public.platform_supabase_usage() to service_role;
