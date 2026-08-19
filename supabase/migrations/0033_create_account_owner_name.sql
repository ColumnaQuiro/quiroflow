-- Owner's full_name previously defaulted to their email (nothing in
-- onboarding ever asked for a real name) -- adds an optional param so the
-- signup form can pass one, falling back to the old email/  "Owner" behavior
-- for safety.
create or replace function public.create_account_with_owner(p_account_name text, p_clinic_name text, p_owner_name text default null)
returns table(account_id uuid, clinic_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_clinic_id uuid;
  v_team_member_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an account';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into accounts (name, slug)
    values (p_account_name, generate_unique_account_slug(p_account_name))
    returning id into v_account_id;
  insert into clinics (account_id, name) values (v_account_id, p_clinic_name) returning id into v_clinic_id;
  insert into calendar_resources (account_id, clinic_id, name)
    values (v_account_id, v_clinic_id, 'Room 1');
  insert into team_members (account_id, user_id, full_name, role)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner')
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;
