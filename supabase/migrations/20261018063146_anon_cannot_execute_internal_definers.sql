-- Internal SECURITY DEFINER functions were executable by `anon`.
--
-- PostgREST grants EXECUTE on every new function to public, so each helper
-- behind the RLS policies -- is_account_member(), has_permission(),
-- my_member_account_ids() and friends -- and each staff RPC
-- (get_my_bootstrap, create_account_with_owner, cancel_patient_appointment)
-- could be called at /rest/v1/rpc/<name> with nothing but the publishable
-- key. All of them key on auth.uid() and answer nothing without a session,
-- which is why this never leaked anything; settle_imported_invoices() did
-- not, and 20261017163212 closed that one. This closes the rest, so the next
-- helper written with a guard like that one's is not reachable either.
--
-- Left executable by anon, deliberately, because the public pages call them
-- without a session: get_public_booking_info, get_public_booking_policy,
-- get_booking_busy_times, get_booking_blocked_times, get_public_class_sessions,
-- create_public_booking, join_public_class_waitlist, get_public_patient_doc,
-- save_public_patient_doc, get_clinic_by_code, record_app_open,
-- record_review_request_opened. Trigger functions are not callable through
-- PostgREST at all.
--
-- The RLS policies that call these helpers are only ever evaluated for a
-- role that holds the table privilege and has a session (every policy here
-- is for `authenticated`, or keys on auth.uid() being set), and the public
-- pages read through the RPCs above rather than the tables, so an anonymous
-- request never reaches a policy that would now be refused the helper. The
-- service role bypasses RLS and keeps EXECUTE.
do $$
declare
  f text;
begin
  foreach f in array array[
    'can_access_patient(uuid, uuid)',
    'cancel_patient_appointment(uuid)',
    'clinic_location_allowance(uuid)',
    'create_account_with_owner(text, text, text, text, text, boolean)',
    'current_team_member_id(uuid)',
    'get_my_bootstrap()',
    'get_my_permissions(uuid)',
    'has_permission(uuid, text)',
    'is_account_owner(uuid)',
    'is_my_staff_task(uuid, uuid, uuid)',
    'is_my_team_member(uuid, uuid)',
    'my_accessible_invoice_ids()',
    'my_all_calendar_scope_accounts()',
    'my_all_patient_scope_accounts()',
    'my_editable_invoice_ids()',
    'my_member_account_ids()',
    'my_own_docs_scope_accounts()',
    'my_own_patient_access()',
    'my_own_patient_ids()',
    'my_patients_scope()',
    'my_permitted_accounts(text)',
    'my_team_member_id()',
    'my_team_member_identities()',
    'permission_scope(uuid, text)',
    'practitioner_seat_allowance(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
