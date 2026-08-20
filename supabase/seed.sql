-- Local-dev-only bootstrap (never applied to the linked remote project).
--
-- Supabase Cloud provisions default schema privileges for anon/authenticated/
-- service_role automatically when a project is created; a fresh local
-- `supabase start` Postgres does not, so service_role (used by anything with
-- the service_role/secret key, e.g. server-side webhooks and test seeding)
-- gets "permission denied" on every table until these are granted.
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines to service_role;

-- anon/authenticated get the same broad table/sequence grants Supabase Cloud
-- provisions by default -- RLS policies (already defined by the app's own
-- migrations) are what actually restrict access per row. Deliberately NOT
-- touching function EXECUTE privileges here: Postgres grants EXECUTE to
-- PUBLIC by default on function creation, and 0003_lock_down_function_grants
-- already explicitly revoked it from anon/public on a few sensitive RPCs --
-- a blanket grant here would silently undo that lockdown.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
