-- Family accounts: a parent gets their child's app the moment the desk links
-- them, without a second step.
--
-- Until now "Acceso en la app" (patient_managers, 20261106053857) was always
-- set by hand, even for the plainest case: the desk links Nico, 7, as Elena's
-- son under Familia, and then has to open the form below the link and save the
-- guardian access the form had already chosen for them. Decided 11 Nov 2026:
-- for a minor that second step is automatic.
--
-- WHEN: a parent/child link between an adult and somebody still of guardian
-- age (under 16 by date of birth; with none, while is_minor is set) gets a
-- guardian link with full access, the parent managing the child -- exactly
-- what the form proposes. Both parents, when both are linked. The desk can
-- take it away again from the same place; nothing puts it back unless the
-- family link itself is made again.
--
-- ONLY WHEN THE DESK MADE THE LINK, which is what created_by records
-- (FamilyCard.vue sets it). The AI receptionist also writes parent/child
-- links (receptionistBooking.ts: linkChild, and the person somebody brings),
-- from what was said in a WhatsApp chat and without created_by. A chat
-- message is not the clinic confirming who a child's guardian is, and a
-- guardian link reaches the child's documents and messages, so those stay
-- for the desk to grant by hand.
--
-- Everything else is unchanged and still by hand: adults (partners, siblings,
-- an adult child), and anybody 16 or older, need their own consent.
--
-- The guardian link lapses at 16 by itself, read at query time
-- (patients_i_can_act_for), so nothing here has to undo it later.

create or replace function public.patient_relations_grant_guardian()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_id uuid;
  v_child_id uuid;
  v_manager public.patients%rowtype;
  v_child public.patients%rowtype;
begin
  if new.created_by is null or new.relation not in ('parent', 'child') then
    return new;
  end if;

  -- (patient, related, relation) reads "related is patient's <relation>".
  if new.relation = 'child' then
    v_manager_id := new.patient_id;
    v_child_id := new.related_patient_id;
  else
    v_manager_id := new.related_patient_id;
    v_child_id := new.patient_id;
  end if;

  select * into v_manager from public.patients where id = v_manager_id;
  select * into v_child from public.patients where id = v_child_id;

  -- What patient_managers_check would refuse, checked first so that linking
  -- a family member never fails because the access could not be given.
  if v_manager.account_id is distinct from new.account_id or v_child.account_id is distinct from new.account_id
     or v_manager.anonymized_at is not null or v_child.anonymized_at is not null
     or v_manager.is_minor
     or (v_manager.date_of_birth is not null and v_manager.date_of_birth > (current_date - interval '18 years')::date)
     or not public.patient_is_guardian_age(v_child.date_of_birth, v_child.is_minor) then
    return new;
  end if;

  -- The link is written both ways in one insert, so this runs twice for the
  -- same pair; the second finds the first and does nothing.
  insert into public.patient_managers (account_id, manager_patient_id, patient_id, basis, access, granted_by)
  values (new.account_id, v_manager_id, v_child_id, 'guardian', 'full', new.created_by)
  on conflict (manager_patient_id, patient_id) do nothing;

  return new;
end;
$$;

create trigger patient_relations_grant_guardian
  after insert on public.patient_relations
  for each row execute function public.patient_relations_grant_guardian();

-- The children the desk has already linked get it too. Same rules as the
-- trigger: a desk-made link, an adult parent, a child of guardian age, and
-- never over a link the desk already set (whatever its basis or access).
insert into public.patient_managers (account_id, manager_patient_id, patient_id, basis, access, granted_by)
select distinct on (r.patient_id, r.related_patient_id)
       r.account_id, r.patient_id, r.related_patient_id, 'guardian', 'full', r.created_by
from public.patient_relations r
join public.patients m on m.id = r.patient_id
join public.patients c on c.id = r.related_patient_id
where r.relation = 'child'
  and r.created_by is not null
  and m.account_id = r.account_id and c.account_id = r.account_id
  and m.anonymized_at is null and c.anonymized_at is null
  and not coalesce(m.is_minor, false)
  and (m.date_of_birth is null or m.date_of_birth <= (current_date - interval '18 years')::date)
  and public.patient_is_guardian_age(c.date_of_birth, c.is_minor)
on conflict (manager_patient_id, patient_id) do nothing;
