-- These functions are only meant to be called by logged-in users (either
-- directly, in the case of onboarding, or implicitly via RLS policy
-- evaluation for is_account_member/is_own_patient_account). Revoke the
-- default PUBLIC/anon execute grant Postgres adds on function creation.

revoke execute on function create_account_with_owner(text, text) from public;
revoke execute on function create_account_with_owner(text, text) from anon;
grant execute on function create_account_with_owner(text, text) to authenticated;

revoke execute on function is_account_member(uuid) from public;
revoke execute on function is_account_member(uuid) from anon;
grant execute on function is_account_member(uuid) to authenticated;

revoke execute on function is_own_patient_account(uuid) from public;
revoke execute on function is_own_patient_account(uuid) from anon;
grant execute on function is_own_patient_account(uuid) to authenticated;
