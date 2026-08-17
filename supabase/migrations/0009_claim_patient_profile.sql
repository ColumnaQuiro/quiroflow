-- Lets a patient self-serve claim their existing patient record by
-- matching their auth email to a patients row that has no user_id yet.
-- Security definer since the normal patients RLS only lets staff or the
-- already-linked patient touch a row -- there's no "match by email" path
-- available to an ordinary authenticated user otherwise.

create or replace function claim_patient_profile()
returns table (patient_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_patient_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from patients where user_id = auth.uid()) then
    return query select id from patients where user_id = auth.uid();
    return;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'No email on account';
  end if;

  select id into v_patient_id from patients
  where lower(email) = lower(v_email) and user_id is null
  limit 1;

  if v_patient_id is null then
    raise exception 'No matching patient record found';
  end if;

  update patients set user_id = auth.uid() where id = v_patient_id;

  return query select v_patient_id;
end;
$$;

revoke execute on function claim_patient_profile() from public;
revoke execute on function claim_patient_profile() from anon;
grant execute on function claim_patient_profile() to authenticated;
