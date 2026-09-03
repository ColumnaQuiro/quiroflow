-- The Calendar's tab bar (pages/calendar.vue) listed every team member
-- assigned to the clinic with no role check at all -- Front Desk staff
-- showed up as a schedulable column right alongside actual practitioners.
-- The obvious fix isn't "filter by role = 'practitioner'" though: role
-- (and the newer role_id/account_roles RBAC system) governs what someone
-- can *do* in the app, not whether they see patients. In practice an Owner
-- can also be the clinic's main treating practitioner (this account's data
-- has exactly that case -- an 'owner' row with thousands of appointments
-- against it as practitioner_id), so practitioner-ness needs its own
-- independent flag rather than being derived from the permission role.
alter table team_members add column is_practitioner boolean not null default false;

-- Backfill: anyone already tagged role='practitioner' is one by definition.
-- For everyone else, judge by what they've actually been doing -- a
-- meaningful history of appointments assigned as practitioner_id (not just
-- one or two, which is more likely a data-entry slip than a real clinical
-- role) -- so an owner who's really running the clinic's chair gets carried
-- over correctly without hand-picking accounts.
update team_members set is_practitioner = true where role = 'practitioner';

update team_members tm
set is_practitioner = true
where tm.is_practitioner = false
  and (select count(*) from appointments a where a.practitioner_id = tm.id) > 5;

-- New solo-owner signups are overwhelmingly a practicing owner (same
-- pattern the backfill above just captured for existing accounts) -- default
-- them in so a brand-new account's calendar isn't empty on first login.
create or replace function public.create_account_with_owner(p_account_name text, p_clinic_name text)
returns table(account_id uuid, clinic_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_clinic_id uuid;
  v_team_member_id uuid;
  v_owner_role_id uuid;
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

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(v_email, 'Owner'), 'owner', v_owner_role_id, true, true)
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;

create or replace function public.create_account_with_owner(p_account_name text, p_clinic_name text, p_owner_name text default null::text)
returns table(account_id uuid, clinic_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_clinic_id uuid;
  v_team_member_id uuid;
  v_owner_role_id uuid;
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

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, true)
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;

-- An accepted invite defaults to practitioner unless it was explicitly a
-- Front Desk invite -- matches the same "practitioner unless told
-- otherwise" default pages/settings/team.vue's invite form already applies
-- to the legacy role column. Whoever accepts can be flipped either way
-- afterward from Settings -> Team.
create or replace function public.accept_invite(p_token text)
returns table(account_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite record;
  v_email text;
  v_team_member_id uuid;
  v_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from account_invites where token = p_token and accepted_at is null;
  if not found then
    raise exception 'Invalid or already-used invite link';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'You already belong to a practice';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  v_role_id := v_invite.role_id;
  if v_role_id is null then
    select id into v_role_id from account_roles
      where account_id = v_invite.account_id
        and name = case v_invite.role when 'owner' then 'Owner' when 'front_desk' then 'Front Desk' else 'Practitioner' end;
  end if;

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
  values (
    v_invite.account_id, auth.uid(), coalesce(nullif(trim(v_invite.full_name), ''), v_email, 'Team member'),
    v_invite.role, v_role_id, false, v_invite.role <> 'front_desk'
  )
  returning id into v_team_member_id;

  insert into team_member_clinics (team_member_id, clinic_id)
  select v_team_member_id, c.id from clinics c where c.account_id = v_invite.account_id;

  if v_invite.link_practitioner_name is not null then
    update appointments
      set practitioner_id = v_team_member_id
      where account_id = v_invite.account_id
        and practitioner_name = v_invite.link_practitioner_name
        and practitioner_id is null;
  end if;

  update account_invites set accepted_at = now() where id = v_invite.id;

  return query select v_invite.account_id;
end;
$function$;

-- Online booking's practitioner list needs the same gate as the internal
-- calendar -- a Front Desk row with online_booking_enabled left on
-- (nothing stopped that before) shouldn't appear as a bookable
-- practitioner either.
create or replace function get_public_booking_info(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_name text;
  v_result jsonb;
begin
  select id, name into v_account_id, v_account_name from accounts where slug = p_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  select jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'id', a.id, 'name', a.name,
        'online_booking_max_days_ahead', a.online_booking_max_days_ahead,
        'online_booking_gtm_id', a.online_booking_gtm_id,
        'online_booking_referral_url', a.online_booking_referral_url,
        'online_booking_primary_color', a.online_booking_primary_color,
        'online_booking_secondary_color', a.online_booking_secondary_color,
        'online_booking_background_color', a.online_booking_background_color,
        'online_booking_hide_logo', a.online_booking_hide_logo,
        'online_booking_practitioner_order', a.online_booking_practitioner_order,
        'online_booking_text_overrides', a.online_booking_text_overrides,
        'appointment_confirmation_enabled', a.appointment_confirmation_enabled,
        'appointment_confirmation_channels', a.appointment_confirmation_channels,
        'discount_codes_enabled', exists (
          select 1 from online_booking_discount_codes d where d.account_id = a.id and d.active = true
        )
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'logo_storage_path', c.logo_storage_path
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_payment_required', at.online_payment_required,
        'online_bookable_by', at.online_bookable_by,
        'online_bypass_practitioner', at.online_bypass_practitioner,
        'online_max_days_ahead', at.online_max_days_ahead,
        'online_deposit_cents', at.online_deposit_cents
      ) order by at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color, 'business_hours', tm.business_hours,
        'photo_storage_path', tm.photo_storage_path,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true and tm.is_practitioner = true
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Server-side mirror of the same gate -- get_public_booking_info keeps a
-- non-practitioner out of the widget's practitioner list, but this is the
-- function that actually creates the booking, so it needs its own check
-- rather than trusting the client only saw practitioners to pick from.
create or replace function create_public_booking(
  p_account_slug text,
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_country_code text default 'ES',
  p_discount_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_duration int;
  v_override_duration int;
  v_type_price int;
  v_override_price int;
  v_effective_price int;
  v_payment_required boolean;
  v_bookable_by text;
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_deposit_cents int;
  v_charge_amount int;
  v_discount_id uuid;
  v_percent_off int;
  v_amount_off_cents int;
  v_max_uses int;
  v_times_used int;
  v_discount_applied_cents int := 0;
  v_ends_at timestamptz;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  select id, online_booking_max_days_ahead into v_account_id, v_max_days_ahead
  from accounts where slug = p_account_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  if not exists (
    select 1 from clinics
    where id = p_clinic_id and account_id = v_account_id and online_booking_enabled = true
  ) then
    raise exception 'Clinic not available for online booking';
  end if;

  select duration_minutes, default_price_cents, online_payment_required,
         online_bookable_by, online_max_days_ahead, online_deposit_cents
    into v_duration, v_type_price, v_payment_required,
         v_bookable_by, v_type_max_days_ahead, v_deposit_cents
  from appointment_types
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
  end if;

  select duration_minutes, price_cents into v_override_duration, v_override_price
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
  end if;
  v_effective_price := coalesce(v_override_price, v_type_price);

  if not exists (
    select 1 from team_members tm
    join team_member_clinics tmc on tmc.team_member_id = tm.id
    where tm.id = p_team_member_id and tm.account_id = v_account_id
      and tm.online_booking_enabled = true and tm.is_practitioner = true and tmc.clinic_id = p_clinic_id
  ) then
    raise exception 'Practitioner not available';
  end if;

  if p_first_name is null or trim(p_first_name) = '' then
    raise exception 'First name required';
  end if;
  if p_email is null or trim(p_email) = '' then
    raise exception 'Email required';
  end if;
  if p_starts_at < now() then
    raise exception 'Cannot book a time in the past';
  end if;

  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  if exists (
    select 1 from appointments
    where practitioner_id = p_team_member_id
      and status <> 'cancelled'
      and starts_at < v_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  select id into v_patient_id from patients
  where account_id = v_account_id and lower(email) = lower(trim(p_email))
  limit 1;

  if v_bookable_by = 'new_patients' and v_patient_id is not null then
    raise exception 'This appointment type is only available to new patients';
  elsif v_bookable_by = 'existing_patients' and v_patient_id is null then
    raise exception 'This appointment type is only available to existing patients';
  end if;

  if v_patient_id is null then
    insert into patients (account_id, clinic_id, first_name, last_name, email)
    values (
      v_account_id, p_clinic_id, trim(p_first_name),
      nullif(trim(coalesce(p_last_name, '')), ''),
      lower(trim(p_email))
    )
    returning id into v_patient_id;
  end if;

  if p_phone is not null and trim(p_phone) <> '' and not exists (
    select 1 from patient_contact_numbers where patient_id = v_patient_id and number = trim(p_phone)
  ) then
    insert into patient_contact_numbers (account_id, patient_id, number, country_code)
    values (v_account_id, v_patient_id, trim(p_phone), coalesce(p_country_code, 'ES'));
  end if;

  insert into appointments (
    account_id, clinic_id, practitioner_id, patient_id, appointment_type_id,
    starts_at, ends_at, status, source
  )
  values (
    v_account_id, p_clinic_id, p_team_member_id, v_patient_id, p_appointment_type_id,
    p_starts_at, v_ends_at, 'booked', 'online'
  )
  returning id into v_appointment_id;

  if p_note is not null and trim(p_note) <> '' then
    insert into visit_notes (account_id, appointment_id, body, created_by)
    values (v_account_id, v_appointment_id, trim(p_note), null);
  end if;

  if v_payment_required and v_effective_price > 0 then
    v_charge_amount := coalesce(v_deposit_cents, v_effective_price);

    if p_discount_code is not null and trim(p_discount_code) <> '' then
      select id, percent_off, amount_off_cents, max_uses, times_used
        into v_discount_id, v_percent_off, v_amount_off_cents, v_max_uses, v_times_used
      from online_booking_discount_codes
      where account_id = v_account_id and code = trim(p_discount_code) and active = true
        and (expires_at is null or expires_at > now())
      for update;

      if v_discount_id is null then
        raise exception 'Invalid or expired discount code';
      end if;
      if v_max_uses is not null and v_times_used >= v_max_uses then
        raise exception 'This discount code has reached its usage limit';
      end if;

      if v_percent_off is not null then
        v_discount_applied_cents := v_discount_applied_cents + (v_charge_amount * v_percent_off / 100);
      end if;
      if v_amount_off_cents is not null then
        v_discount_applied_cents := v_discount_applied_cents + v_amount_off_cents;
      end if;
      v_discount_applied_cents := least(v_discount_applied_cents, v_charge_amount);
      v_charge_amount := v_charge_amount - v_discount_applied_cents;

      update online_booking_discount_codes set times_used = times_used + 1 where id = v_discount_id;
    end if;

    if v_charge_amount > 0 then
      select 'INV-' || lpad((count(*) + 1)::text, 4, '0') into v_invoice_number from invoices;

      insert into invoices (account_id, patient_id, appointment_id, invoice_number, status, total_cents)
      values (v_account_id, v_patient_id, v_appointment_id, v_invoice_number, 'unpaid', v_charge_amount)
      returning id into v_invoice_id;

      insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
      select v_account_id, v_invoice_id,
             at.name || case when v_deposit_cents is not null then ' (deposit)' else '' end,
             1, v_charge_amount
      from appointment_types at where at.id = p_appointment_type_id;
    end if;
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'invoice_id', v_invoice_id,
    'payment_required_cents', case when v_invoice_id is not null then v_charge_amount else 0 end,
    'discount_applied_cents', v_discount_applied_cents
  );
end;
$$;
