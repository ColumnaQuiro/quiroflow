-- Three findings from Supabase's own database linter, and only the ones that
-- are real. The linter reports 100+ rows; most of them are this app working
-- as designed, and they are listed at the bottom so the next person does not
-- re-litigate them.

-- 1. Trigger functions were callable as RPCs -------------------------------
--
-- Every one of these returns `trigger` and exists to be fired BY a trigger.
-- PostgREST does not know that: it exposes anything in `public` that a role
-- can execute, so all fourteen sat on /rest/v1/rpc/<name> for `anon` and
-- `authenticated` alike, and eight of them are SECURITY DEFINER.
--
-- Calling one outside a trigger raises rather than doing damage -- there is
-- no NEW row to act on -- so this is hardening, not an incident. But nothing
-- should be able to reach fn_audit_log or record_factura_alta over HTTP, and
-- a trigger keeps firing normally whatever these grants say: a trigger runs
-- as the table owner and never consults EXECUTE on the function at all.
--
-- FROM PUBLIC, not from anon. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and every one of these carries it -- `=X/postgres` at
-- the head of proacl. Revoking from anon alone leaves that grant standing and
-- anon keeps the privilege through it, which is a migration that reads like
-- it did something and did not. anon and authenticated are named as well
-- because most of these also hold a direct grant; service_role and the owner
-- have their own and are untouched.
revoke execute on function public.automation_sequence_runs_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_practitioner_seats() from public, anon, authenticated;
revoke execute on function public.factura_records_are_append_only() from public, anon, authenticated;
revoke execute on function public.fill_factura_tax() from public, anon, authenticated;
revoke execute on function public.fn_audit_log() from public, anon, authenticated;
revoke execute on function public.fn_dispatch_webhook_event() from public, anon, authenticated;
revoke execute on function public.fn_sync_patient_has_phone() from public, anon, authenticated;
revoke execute on function public.leads_sync_ai_handling() from public, anon, authenticated;
revoke execute on function public.leads_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.receptionist_config_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.record_factura_alta() from public, anon, authenticated;
revoke execute on function public.reviews_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.seed_payment_methods_for_new_account() from public, anon, authenticated;
revoke execute on function public.stamp_created_by() from public, anon, authenticated;

-- 2. Three SECURITY DEFINER functions were reachable by `anon` -------------
--
-- This is the finding that matters, and it comes from one guard shape:
--
--   if auth.uid() is not null and not has_permission(...) then raise ...
--
-- which reads "check the caller's permission, unless there is no caller".
-- It is written that way so the service role -- which has no auth.uid() --
-- can call these from the server. `anon` has no auth.uid() either, so an
-- unauthenticated request went straight past the check.
--
-- next_factura_number and next_invoice_number both INCREMENT a sequence
-- before returning, so anyone able to call them could walk a clinic's
-- numbering forward from outside. For facturas that is not merely untidy:
-- the series has to be sequential and unbroken, and from 2027 it is what
-- gets transmitted to the AEAT.
--
-- Both are called from the browser with the user's own session, so
-- `authenticated` keeps EXECUTE and goes on being checked by the guard. Only
-- `anon` loses it -- and here a plain revoke is enough, because these four
-- were granted per role and never to PUBLIC.
revoke execute on function public.next_factura_number(uuid, text) from anon;
revoke execute on function public.next_invoice_number(uuid, text) from anon;

-- rebuild_factura_huellas has no guard of any kind, and it rewrites the
-- VeriFactu hash chain for a whole account. Nothing in the app calls it --
-- only cypress/support/tasks/db.ts, through the service role -- so it does
-- not need to be reachable by a signed-in user either.
revoke execute on function public.rebuild_factura_huellas(uuid, text) from public, anon, authenticated;

-- merge_patients and account_usage do check membership properly, so this is
-- only closing a door nobody should be at.
revoke execute on function public.merge_patients(uuid, uuid) from anon;
revoke execute on function public.account_usage(uuid) from anon;

-- 3. Functions with a mutable search_path ----------------------------------
--
-- None of these eight is SECURITY DEFINER, which is why this is last. It
-- still matters: factura_huella and factura_huella_input are called BY
-- rebuild_factura_huellas and record_factura_alta, which are, and a function
-- without its own search_path resolves names using the caller's. Pinning it
-- means a schema earlier on someone's search_path cannot shadow `digest` or
-- a table these rely on.
--
-- pg_temp goes last, explicitly: leaving it out lets a temporary table
-- shadow a real one, and putting it first is the classic version of the same
-- bug.
--
-- `set search_path` replaces only that one setting, so factura_huella_input
-- keeps its TimeZone=Europe/Madrid -- which is load-bearing, since the huella
-- hashes a Madrid-local timestamp.
alter function public.factura_huella(text) set search_path = public, pg_temp;
alter function public.factura_huella_input(text, text, date, text, integer, integer, text, timestamptz) set search_path = public, pg_temp;
alter function public.factura_huella_probe(text, text, date, text, integer, integer, text, timestamptz) set search_path = public, pg_temp;
alter function public.factura_huella_spec_version() set search_path = public, pg_temp;
alter function public.factura_invoice_type(text) set search_path = public, pg_temp;
alter function public.factura_records_are_append_only() set search_path = public, pg_temp;
alter function public.seed_payment_methods(uuid) set search_path = public, pg_temp;
alter function public.stamp_created_by() set search_path = public, pg_temp;

-- What the linter reports that is NOT a bug, so nobody spends an afternoon
-- on it twice:
--
--  * rls_enabled_no_policy on account_secrets, verifactu_certificates,
--    whatsapp_app_secrets, the *_number_sequences and the dated backup
--    tables. RLS on with no policy is DENY ALL, reachable only by the
--    service role. That is the intent for every one of them.
--
--  * ~100 rows of "<role> can execute SECURITY DEFINER function". Most are
--    the RLS helpers -- is_account_member, has_permission, my_patients_scope
--    and friends -- which are called from inside the policies themselves and
--    are evaluated as the invoking role. Revoking those does not harden
--    anything; it breaks row level security outright. The rest are the
--    public booking and patient-app RPCs, which are meant to answer `anon`.
--
--  * extension_in_public for pg_net and pg_trgm. Moving an installed
--    extension rewrites every reference to it, and neither is a security
--    boundary. Left where they are deliberately.
