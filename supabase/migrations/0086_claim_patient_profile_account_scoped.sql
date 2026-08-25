-- claim_patient_profile() had zero clinic scoping: if the same email
-- exists as a patients row (user_id is null) at two different clinics, it
-- silently linked to whichever one Postgres returned first (limit 1, no
-- order by). Now accepts an optional account slug (the same slug already
-- public via booking URLs) to disambiguate. See composables/useIdentity.ts
-- and mobile/pages/join.vue for the caller that supplies it.

drop function if exists claim_patient_profile();

create or replace function claim_patient_profile(p_account_slug text default null)
returns table (patient_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_patient_id uuid;
  v_account_id uuid;
  v_match_count int;
  v_distinct_accounts int;
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

  if p_account_slug is not null then
    select id into v_account_id from accounts where slug = lower(trim(p_account_slug));
    if v_account_id is null then
      raise exception 'Unknown clinic';
    end if;

    select id into v_patient_id from patients
    where account_id = v_account_id and lower(email) = lower(v_email) and user_id is null
    limit 1;

    if v_patient_id is null then
      raise exception 'No matching patient record found';
    end if;
  else
    -- No clinic specified (web portal's existing zero-arg call). Duplicate
    -- rows within ONE clinic sharing an email is a pre-existing data-quality
    -- issue, not this bug -- keep today's arbitrary pick for that case. Only
    -- raise when matches span more than one clinic, since silently picking
    -- one there means linking the wrong clinic entirely.
    select count(*), count(distinct account_id) into v_match_count, v_distinct_accounts
    from patients where lower(email) = lower(v_email) and user_id is null;

    if v_match_count = 0 then
      raise exception 'No matching patient record found';
    elsif v_distinct_accounts > 1 then
      raise exception 'Multiple clinics match this email -- specify one';
    end if;

    select id into v_patient_id from patients
    where lower(email) = lower(v_email) and user_id is null limit 1;
  end if;

  update patients set user_id = auth.uid() where id = v_patient_id;

  return query select v_patient_id;
end;
$$;

revoke execute on function claim_patient_profile(text) from public;
revoke execute on function claim_patient_profile(text) from anon;
grant execute on function claim_patient_profile(text) to authenticated;
