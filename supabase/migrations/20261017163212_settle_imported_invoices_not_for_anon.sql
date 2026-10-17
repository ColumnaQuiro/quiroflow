-- settle_imported_invoices() could be called without signing in.
--
-- It is SECURITY DEFINER, and its guard reads
--
--   if auth.uid() is not null and not has_permission(p_account_id, 'data_admin')
--
-- so a caller with NO auth.uid() passes. That path exists for the service
-- role, which has no uid. But PostgREST grants EXECUTE on every new function
-- to public, so `anon` -- anyone holding the publishable key, which is in the
-- page source -- could POST /rest/v1/rpc/settle_imported_invoices with any
-- account id and have that clinic's imported invoices re-marked paid/unpaid.
-- Verified against production under `set role anon`: the call was accepted.
--
-- Nothing legitimate calls it anonymously. The one caller in the app is the
-- PracticeHub ledger importer (components/import/PracticeHubLedgerImporter.vue),
-- signed in as a team member, and the service role keeps its grant. The
-- function body is unchanged.
revoke execute on function public.settle_imported_invoices(uuid) from public, anon;
grant execute on function public.settle_imported_invoices(uuid) to authenticated, service_role;

-- Reported by the Supabase security advisor: the one function in public with
-- a role-mutable search_path. Same setting every other function here carries.
alter function public.appointments_answer_is_for_its_time() set search_path = public;
