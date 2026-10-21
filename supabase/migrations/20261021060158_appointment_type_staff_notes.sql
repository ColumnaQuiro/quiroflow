-- A note on an appointment type for the team only: "check finances", "hand
-- over the VIP vouchers", "scans on this one -- book the room with the
-- machine". Clinics were making extra appointment types just to carry a
-- reminder like that in the name, and the name is what the patient sees in
-- their confirmation (PracticeHub community, July 2026).
--
-- Its own table, not a column on appointment_types: a patient may read the
-- whole row of every type they have a visit of ("patients read types of own
-- appointments"), so a column there would hand the note to the patient app
-- and the portal. Here only the team reads it, and whoever may configure the
-- clinic (clinic_config) writes it, as with the types themselves.
--
-- Keyed by the type's own id, so the audit trail files a change to the note
-- under that appointment type (fn_audit_log takes the row's "id").

create table public.appointment_type_staff_notes (
  id uuid primary key references public.appointment_types(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  note text not null check (char_length(btrim(note)) between 1 and 500),
  updated_at timestamptz not null default now()
);

alter table public.appointment_type_staff_notes enable row level security;
create policy "team reads appointment type notes" on public.appointment_type_staff_notes
  for select
  using (is_account_member(account_id));
create policy "clinic config writes appointment type notes" on public.appointment_type_staff_notes
  for all
  using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (
    is_account_member(account_id)
    and has_permission(account_id, 'clinic_config')
    and exists (select 1 from public.appointment_types t where t.id = appointment_type_staff_notes.id and t.account_id = appointment_type_staff_notes.account_id)
  );
select public.require_two_factor_on('public.appointment_type_staff_notes');

select public.grant_data_api('public.appointment_type_staff_notes');

create trigger trg_audit_appointment_type_staff_notes after insert or update or delete on public.appointment_type_staff_notes
  for each row execute function public.fn_audit_log('appointment_type', 'updated_at');
