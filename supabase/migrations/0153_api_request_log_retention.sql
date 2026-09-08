-- api_request_logs (0149) has no upper bound: every public API call writes a
-- row and nothing ever removes one. At the current handful of integrations
-- that is invisible, which is exactly why it is worth fixing now -- the table
-- only becomes a problem once the API is popular, and by then it is a
-- problem on a table nobody is watching.
--
-- 90 days is well past useful: the log exists so a clinic can see what an
-- integration is doing now and debug it when it breaks, not as an audit
-- trail. Settings > Developers only ever renders the most recent 30 rows.
--
-- Unlike the cron jobs described in 0081, this one carries no deployment URL
-- and no secret -- it is a plain SQL delete -- so it belongs in a migration
-- and applies identically everywhere, local included.

create or replace function prune_api_request_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from api_request_logs where created_at < now() - interval '90 days';
$$;

revoke execute on function prune_api_request_logs() from public, anon, authenticated;

-- Idempotent: unschedule first so re-running the migration (or editing the
-- schedule later) doesn't leave two jobs racing on the same table.
do $$
begin
  perform cron.unschedule('prune-api-request-logs');
exception when others then
  -- No such job yet: the expected path on a first run.
  null;
end $$;

-- 03:20 daily, deliberately off the :00 and :15 marks the appointment crons
-- already occupy so it isn't competing with them for a worker.
select cron.schedule('prune-api-request-logs', '20 3 * * *', $$select prune_api_request_logs()$$);
