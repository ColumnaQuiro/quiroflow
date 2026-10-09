-- Who put a patient on the waitlist. Since join_my_waitlist (the patient app
-- and portal's "Avísame"), patients add themselves; the front desk's list
-- could not tell those from its own. created_by does not answer it --
-- imports and older paths leave it empty too -- so the entry says so.
alter table public.waitlist_entries add column if not exists source text;

comment on column public.waitlist_entries.source is
  'patient = added by the patient themselves (join_my_waitlist); null = staff or anything older';

create or replace function public.join_my_waitlist(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_entry_id uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;

  select c.account_id into v_account_id
  from public.clinics c
  join public.accounts a on a.id = c.account_id
  where c.id = p_clinic_id and c.archived_at is null and a.patient_app_booking_enabled = true;
  if v_account_id is null then
    raise exception 'This clinic does not take waitlist requests from the app';
  end if;

  select p.id into v_patient_id
  from public.patients p
  where p.user_id = auth.uid() and p.account_id = v_account_id
  limit 1;
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  select w.id into v_entry_id
  from public.waitlist_entries w
  where w.patient_id = v_patient_id and w.clinic_id = p_clinic_id and w.status in ('waiting', 'offered')
  limit 1;
  if v_entry_id is not null then
    return v_entry_id;
  end if;

  insert into public.waitlist_entries (account_id, clinic_id, patient_id, status, source)
  values (v_account_id, p_clinic_id, v_patient_id, 'waiting', 'patient')
  returning id into v_entry_id;
  return v_entry_id;
end;
$$;

revoke all on function public.join_my_waitlist(uuid) from public, anon;
grant execute on function public.join_my_waitlist(uuid) to authenticated;
