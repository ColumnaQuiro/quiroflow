-- The patient app's clinic contact and waitlist.
--
-- A patient cannot read the clinics table, so the app could not say where
-- the clinic is or how to call it; and the waitlist was staff-only, so "let
-- me know if something earlier comes up" had to be a phone call. These
-- return or change only the caller's own rows, as the patient they are.

-- Each of the patient's clinics: name, address and phone, for "Cómo llegar"
-- and "Llamar". Archived clinics are closed and not offered.
create or replace function public.get_my_clinics()
returns table (id uuid, name text, address text, phone text, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.address, c.phone, c.timezone
  from public.clinics c
  where c.account_id in (select p.account_id from public.patients p where p.user_id = auth.uid())
    and c.archived_at is null
    and public.mfa_satisfied()
  order by c.name
$$;

revoke all on function public.get_my_clinics() from public, anon;
grant execute on function public.get_my_clinics() to authenticated;

-- The patient's own entries still in play (waiting, or offered a slot).
create or replace function public.get_my_waitlist()
returns table (id uuid, clinic_id uuid, status text, created_at timestamptz, offered_starts_at timestamptz, offer_expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.clinic_id, w.status, w.created_at, w.offered_starts_at, w.offer_expires_at
  from public.waitlist_entries w
  join public.patients p on p.id = w.patient_id
  where p.user_id = auth.uid()
    and w.status in ('waiting', 'offered')
    and public.mfa_satisfied()
  order by w.created_at
$$;

revoke all on function public.get_my_waitlist() from public, anon;
grant execute on function public.get_my_waitlist() to authenticated;

-- Join a clinic's waitlist, as staff would add the patient (status
-- 'waiting', no type or practitioner preference). Only where the clinic lets
-- its patients book from the app: a clinic that has not opened self-service
-- has not agreed to patients putting themselves on its list either. Joining
-- twice returns the entry already there.
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

  insert into public.waitlist_entries (account_id, clinic_id, patient_id, status)
  values (v_account_id, p_clinic_id, v_patient_id, 'waiting')
  returning id into v_entry_id;
  return v_entry_id;
end;
$$;

revoke all on function public.join_my_waitlist(uuid) from public, anon;
grant execute on function public.join_my_waitlist(uuid) to authenticated;

-- Leave it: the patient's own entry, while it is still only waiting. One
-- already offered a slot is answered through the offer itself.
create or replace function public.leave_my_waitlist(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  update public.waitlist_entries w
  set status = 'cancelled'
  from public.patients p
  where w.id = p_entry_id and p.id = w.patient_id and p.user_id = auth.uid() and w.status = 'waiting'
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.leave_my_waitlist(uuid) from public, anon;
grant execute on function public.leave_my_waitlist(uuid) to authenticated;

-- Where "Añadir al calendario" puts a visit's .ics so the app can open it as
-- a URL (see server/api/portal/appointments/calendar-link.post.ts). Private
-- and without policies, like invoice-pdfs: only the service role writes
-- here, and patients only ever see a five-minute signed link, minted after
-- their own RLS read has proved the visit is theirs.
insert into storage.buckets (id, name, public)
values ('calendar-files', 'calendar-files', false)
on conflict (id) do nothing;
