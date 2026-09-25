-- Settings > Roles and permissions, and the permissions that were stored but
-- did nothing.
--
-- The roles editor offered thirty-odd switches. Several of them were saved,
-- seeded into every new account and shown to owners as if they worked, while
-- nothing anywhere read them: "Remove membership/package tags", "Edit
-- packages", "View patient billing history", "Only allow access to own
-- reports", the dashboard's "Own only". An owner who switched one off got no
-- effect at all and no way to tell. This migration is the database half of
-- making them real; the app half is in the same change.
--
-- No permission KEY is renamed or reinterpreted: RLS, server routes and specs
-- read them by name, and a role saved last year keeps the meaning it was saved
-- with. Everything below either adds a column, adds a rule where there was
-- none, or widens one policy in a way that keeps what works today working.

-- 1. A description per role ---------------------------------------------------
-- Shown on the roles list and in the editor, so choosing a role for someone
-- no longer means opening each one and reading its switches. Nullable: a
-- clinic's own roles start without one.
alter table public.account_roles add column if not exists description text;

-- Only the three roles every account is seeded with, only where nothing has
-- been written yet, and only by their stored (English) names -- a clinic that
-- renamed "Front Desk" to something else made it their own role, and it is
-- not ours to describe. Spanish, like the product: every clinic on it today
-- is in Spain. The app shows these three translated for an English-speaking
-- member when the stored text is still exactly this default.
update public.account_roles
set description = 'Acceso total. No se puede editar: lo que decide el acceso de un propietario es ser propietario, no el rol.'
where description is null and is_system and name = 'Owner';

update public.account_roles
set description = 'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.'
where description is null and not is_system and name = 'Practitioner';

update public.account_roles
set description = 'Lleva la agenda y el mostrador: todos los pacientes y citas, cobros, caja y bandeja de entrada.'
where description is null and not is_system and name = 'Front Desk';

-- 2. Role names: never blank, never two that differ only by case ----------------
-- The old editor's Save button sat outside its <form>, so the input's
-- `required` never ran and a role could be saved with no name at all. The
-- unique constraint (account_id, name) is case-sensitive, so "recepción" and
-- "Recepción" could sit side by side in the team page's role picker.
--
-- NOT VALID, and a trigger rather than a unique index on lower(name): both
-- apply to every write from here on without first requiring that no account
-- already holds a blank name or a case-only duplicate. An index would fail
-- this migration outright on the first such pair, and fixing that means
-- renaming a clinic's role behind its back.
alter table public.account_roles
  add constraint account_roles_name_not_blank check (btrim(name) <> '') not valid;

create or replace function public.account_roles_name_is_unique()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and lower(btrim(new.name)) = lower(btrim(old.name)) then
    return new;
  end if;
  if exists (
    select 1 from account_roles r
    where r.account_id = new.account_id
      and r.id <> new.id
      and lower(btrim(r.name)) = lower(btrim(new.name))
  ) then
    -- 23505, the code a unique index would have raised, so the app reads a
    -- duplicate the same way whichever check caught it.
    raise exception 'A role called "%" already exists', btrim(new.name) using errcode = '23505';
  end if;
  return new;
end;
$function$;

drop trigger if exists account_roles_name_is_unique on public.account_roles;
create trigger account_roles_name_is_unique
  before insert or update of name on public.account_roles
  for each row execute function public.account_roles_name_is_unique();

-- 3. Deleting a role moves its people first -------------------------------------
-- team_members.role_id and account_invites.role_id are ON DELETE SET NULL, so
-- deleting a role that people held left them with no role -- and no role
-- means has_permission() is false for everything: the next page load showed
-- them an empty app. The old page warned about it in a confirm() and did it
-- anyway.
--
-- An RPC rather than three client writes because moving people is a
-- team_members write, which has its own guard (only team admins change a
-- role_id), and the three steps must succeed or fail together: people moved
-- but the role left behind is harmless, the role gone but people not moved is
-- exactly the bug. SECURITY DEFINER only so the three happen in one
-- transaction; every check the policies would make is made here explicitly,
-- and the team_members write still passes through guard_team_member_write as
-- the caller (auth.uid() is unchanged inside a definer function).
create or replace function public.delete_account_role(p_role_id uuid, p_move_to_role_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role account_roles;
  v_target account_roles;
  v_moved integer := 0;
  v_is_owner boolean;
begin
  -- Bypassing RLS also bypasses the restrictive two-factor policies, so a
  -- password-only session is refused here the way it would be there.
  if auth.uid() is null or not public.mfa_satisfied() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_role from account_roles where id = p_role_id for update;
  if not found or not is_account_member(v_role.account_id) then
    raise exception 'Role not found' using errcode = 'P0002';
  end if;
  if not has_permission(v_role.account_id, 'roles_admin') then
    raise exception 'Only someone with Roles and permissions can delete a role' using errcode = '42501';
  end if;
  if v_role.is_system then
    raise exception 'The owner role cannot be deleted' using errcode = '42501';
  end if;

  if exists (select 1 from team_members where role_id = p_role_id)
     or exists (select 1 from account_invites where role_id = p_role_id and accepted_at is null) then
    if p_move_to_role_id is null then
      raise exception 'People still have this role. Choose a role to move them to first.' using errcode = 'P0001';
    end if;
    -- Changing someone's role is a Team permission, not a Roles one. Owners
    -- pass both, as everywhere.
    if not has_permission(v_role.account_id, 'team_admin') then
      raise exception 'Moving people to another role needs the Team permission' using errcode = '42501';
    end if;

    select * into v_target from account_roles
    where id = p_move_to_role_id and account_id = v_role.account_id;
    if not found or v_target.id = v_role.id then
      raise exception 'Choose another role of this clinic to move them to' using errcode = 'P0001';
    end if;
    -- Moving people into the Owner role would hand them every permission as
    -- a side effect of tidying up a role list. Making someone an owner is a
    -- decision made on their own page.
    if v_target.is_system then
      raise exception 'People cannot be moved to the owner role this way' using errcode = '42501';
    end if;

    select exists (
      select 1 from team_members me
      where me.account_id = v_role.account_id and me.user_id = auth.uid() and me.is_owner and me.deleted_at is null
    ) into v_is_owner;
    -- guard_team_member_write refuses a non-owner changing their own role;
    -- say so in words rather than letting that surface mid-way.
    if not v_is_owner and exists (
      select 1 from team_members me
      where me.account_id = v_role.account_id and me.user_id = auth.uid() and me.role_id = p_role_id
    ) then
      raise exception 'You have this role yourself, and only an owner can change your role' using errcode = '42501';
    end if;

    -- The legacy text column follows the same rule the team page uses when
    -- inviting, so the sidebar's role label does not go stale. Owners keep
    -- 'owner': that column is how a few older screens still recognise one.
    update team_members
    set role_id = v_target.id,
        role = case when is_owner then role when v_target.name = 'Front Desk' then 'front_desk' else 'practitioner' end
    where account_id = v_role.account_id and role_id = p_role_id;
    get diagnostics v_moved = row_count;

    update account_invites
    set role_id = v_target.id,
        role = case when v_target.name = 'Front Desk' then 'front_desk' else 'practitioner' end
    where account_id = v_role.account_id and role_id = p_role_id;
  end if;

  delete from account_roles where id = p_role_id;
  return v_moved;
end;
$function$;

revoke all on function public.delete_account_role(uuid, uuid) from public, anon;
grant execute on function public.delete_account_role(uuid, uuid) to authenticated;

-- 4. calendar_read_only reaches deleting, too -----------------------------------
-- 0047 kept a read-only calendar from inserting and updating appointments,
-- but the DELETE policy only asked for appointments_delete -- so a read-only
-- role that also held that key could still delete outright. has_restriction()
-- (0047) rather than `not has_permission(...)`, which is true for every owner
-- and would make every owner read-only.
alter policy "staff delete appointments" on public.appointments
using (
  is_account_member(account_id)
  and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
  and has_permission(account_id, 'appointments_delete')
  and not has_restriction(account_id, 'calendar_read_only')
);

-- 5. "Delete appointments" reaches the delete people actually use ---------------
-- The calendar's "Eliminar cita" is a soft delete -- an UPDATE setting
-- deleted_at -- so it went through the update policy and appointments_delete
-- was never consulted: the Practitioner role, seeded without it precisely so
-- that practitioners cannot delete appointments, could delete any it could
-- see. A trigger, because a policy cannot tell which column an update
-- changes.
--
-- Only a signed-in person is checked. The public API, the WhatsApp webhook
-- and every other server path run as the service role with no auth.uid(),
-- and each has its own authorisation already.
create or replace function public.appointment_delete_needs_permission()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and (select auth.uid()) is not null
     and not has_permission(new.account_id, 'appointments_delete') then
    raise exception 'Your role cannot delete appointments. Cancel it instead.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists appointment_delete_needs_permission on public.appointments;
create trigger appointment_delete_needs_permission
  before update of deleted_at on public.appointments
  for each row execute function public.appointment_delete_needs_permission();

-- 6. packages_edit: selling and changing bonos and memberships -------------------
-- Selling a bono, drawing its sessions from the patient record and voiding
-- one were gated by billing_config -- the Settings permission for the
-- CATALOGUE of bonos -- because that is what the policies below asked for,
-- while packages_edit, the key that says exactly this, did nothing.
--
-- OR, not a swap. Every role that can do this today holds billing_config
-- (owners and whoever an owner gave Billing settings to), and taking it away
-- from them because their role never had a key nobody enforced would break a
-- front desk mid-sale. So billing_config keeps working, and packages_edit
-- now grants the same thing without handing out the catalogue and Stripe
-- settings along with it -- which was the only way to let a receptionist sell
-- a bono until now.
--
-- These are FOR ALL policies, so reading is widened the same way. That is
-- required, not incidental: an insert ... returning, or an update filtered by
-- id, needs the row to be visible.
alter policy "staff manage package_purchases" on public.package_purchases
using (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')))
with check (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')));

alter policy "staff manage patient_memberships" on public.patient_memberships
using (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')))
with check (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')));

-- The catalogue itself -- which bonos and memberships the clinic sells, at
-- what price -- stays writable only with billing_config, which is what that
-- Settings page is. But selling one means choosing it from that list, so
-- anyone in the clinic may now READ it; so may the tag check in section 7,
-- which has to know the names for everyone who lacks patients_tags_remove.
-- Names and prices a receptionist quotes at the desk every day are not a
-- settings power. Permissive policies OR together, so this adds reading and
-- touches nothing else.
drop policy if exists "staff read packages" on public.packages;
create policy "staff read packages" on public.packages
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists "staff read memberships" on public.memberships;
create policy "staff read memberships" on public.memberships
  for select to authenticated
  using (is_account_member(account_id));

-- Logging a membership's payment is part of running the membership, from the
-- same panel, so it follows the same rule.
alter policy "staff manage membership_payments" on public.membership_payments
using (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')))
with check (is_account_member(account_id) and (has_permission(account_id, 'billing_config') or has_permission(account_id, 'packages_edit')));

-- 7. patients_tags_remove -------------------------------------------------------
-- The key came over from PracticeHub, where selling a bono or membership tags
-- the patient with it. QuiroFlow never wrote such tags itself, but it
-- imported eight years of them: PracticeHub's Tags column lands in
-- patients.tags, and there is no separate marker saying where a tag came
-- from. So a "bono or membership tag" is recognised the only way the data
-- allows -- a tag that is the name of one of this clinic's bonos or
-- memberships -- and only removing one of those needs the permission. Every
-- other tag stays exactly as editable as patients_edit already made it.
--
-- Only when tags actually lose an entry, and only for a signed-in person: the
-- public API and importers run as the service role and are authorised on
-- their own.
create or replace function public.patient_tag_removal_needs_permission()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_removed text[];
begin
  if new.tags is not distinct from old.tags or (select auth.uid()) is null then
    return new;
  end if;
  select array_agg(t) into v_removed
  from unnest(coalesce(old.tags, '{}')) t
  where not exists (select 1 from unnest(coalesce(new.tags, '{}')) n where lower(btrim(n)) = lower(btrim(t)));
  if v_removed is null then
    return new;
  end if;
  if exists (
    select 1 from unnest(v_removed) t
    where lower(btrim(t)) in (
      select lower(btrim(p.name)) from packages p where p.account_id = new.account_id
      union
      select lower(btrim(m.name)) from memberships m where m.account_id = new.account_id
    )
  ) and not has_permission(new.account_id, 'patients_tags_remove') then
    raise exception 'Your role cannot remove bono or membership tags' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists patient_tag_removal_needs_permission on public.patients;
create trigger patient_tag_removal_needs_permission
  before update of tags on public.patients
  for each row execute function public.patient_tag_removal_needs_permission();

-- 8. New accounts get the descriptions too --------------------------------------
-- seed_account_roles taken verbatim from 20260922133153_docs_files_
-- practitioner_scope.sql (the latest definition -- md5 of its prosrc matched
-- the database before this was written), with one change: each insert also
-- writes the role's description, the same text the backfill above uses. The
-- `on conflict` clauses are untouched, so re-seeding an existing account
-- still changes nothing in it.
create or replace function public.seed_account_roles(target_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_role_id uuid;

  -- Owner keeps everything. developers_access and inbox_access were added to
  -- the permission model after this function was last written and never made
  -- it into the seeded set; they are here now so a stored Owner role is a
  -- complete record rather than one the UI has to infer.
  v_owner_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": true, "roles_admin": true, "team_admin": true, "clinic_config": true,
    "billing_config": true, "communication_config": true, "data_admin": true,
    "developers_access": true,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": true, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": true,
    "patients_tags_remove": true, "financials_edit_all": true, "financials_edit_same_day_only": false,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": true, "patient_files_delete": true,
    "visit_notes_access": true, "visit_notes_scope": "all", "visit_notes_edit": true, "visit_notes_delete": true,
    "docs_files_scope": "all"
  }'::jsonb;

  -- Scoped to "own" throughout: a practitioner's default view is their own
  -- work. Widening it to the whole clinic is one dropdown in Settings > Roles
  -- and many clinics will want that -- but it should be a decision someone
  -- made, not the state they were handed.
  --
  -- They can charge a visit (billing_access, financials same-day) because
  -- that is the end of an appointment, but cannot reallocate historical
  -- payments, edit packages, or delete anything: appointments, patients,
  -- documents, files and their own past notes all stay put.
  v_practitioner_permissions jsonb := '{
    "dashboard_scope": "own", "calendar_scope": "own", "patients_scope": "own",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": false,
    "reports_access": true, "reports_own_only": true,
    "appointments_delete": false, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": false, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": true, "visit_notes_scope": "own", "visit_notes_edit": true, "visit_notes_delete": false,
    "docs_files_scope": "own"
  }'::jsonb;

  -- The whole diary and patient list, because booking for anyone is the job.
  -- Takes payments and allocates them, answers WhatsApp. Deletes appointments
  -- (a mis-booking is theirs to undo) but not patients, documents or files.
  --
  -- visit_notes_access is false and that is the point of this role existing
  -- separately from Practitioner.
  v_front_desk_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": false, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": false, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false,
    "docs_files_scope": "all"
  }'::jsonb;
begin
  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Owner', true, v_owner_permissions,
            'Acceso total. No se puede editar: lo que decide el acceso de un propietario es ser propietario, no el rol.')
    on conflict (account_id, name) do update set permissions = account_roles.permissions
    returning id into v_owner_role_id;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Practitioner', false, v_practitioner_permissions,
            'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.')
    on conflict (account_id, name) do nothing;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Front Desk', false, v_front_desk_permissions,
            'Lleva la agenda y el mostrador: todos los pacientes y citas, cobros, caja y bandeja de entrada.')
    on conflict (account_id, name) do nothing;

  return v_owner_role_id;
end;
$function$;
