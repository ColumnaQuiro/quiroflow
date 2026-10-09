-- "Confirmar asistencia" in the patient app and the portal: the patient's
-- own say-so that they are coming, as a WhatsApp reply to the reminder
-- already records it (confirmation_status = 'confirmed'). The reminder can
-- now arrive as a push, and a push has no reply -- so the app answers it.
--
-- Only the caller's own visit, still booked, not deleted and not yet begun;
-- anything else returns false and changes nothing.
create or replace function public.confirm_my_appointment(p_appointment_id uuid)
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
  update public.appointments a
  set confirmation_status = 'confirmed'
  from public.patients p
  where a.id = p_appointment_id
    and p.id = a.patient_id
    and p.user_id = auth.uid()
    and a.status = 'booked'
    and a.deleted_at is null
    and a.starts_at > now()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.confirm_my_appointment(uuid) from public, anon;
grant execute on function public.confirm_my_appointment(uuid) to authenticated;
