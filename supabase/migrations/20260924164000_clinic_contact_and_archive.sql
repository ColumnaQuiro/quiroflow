-- Settings -> Clinics, rebuilt as one page per location: a clinic gets its
-- own contact details, and a location that closes is archived rather than
-- deleted.
--
-- 1. phone, email. Shown to patients -- on the booking page once they have
--    booked, and at the foot of confirmation and reminder emails -- so they
--    reach the location they booked at rather than whichever number the
--    account happens to publish. Both optional.
--
-- 2. archived_at. Deleting a clinic was the only way to stop using one, and
--    appointments, calendar_resources, availability_blocks,
--    team_member_clinics and waitlist_entries are all ON DELETE CASCADE from
--    clinics: the ✕ on the old page, behind a bare confirm(), erased a
--    location's whole diary. An archived clinic leaves the clinic switcher
--    (get_my_bootstrap below) and online booking (get_public_booking_info
--    below, and the page turns online_booking_enabled off when it archives);
--    every row that points at it stays, so its history, reports and
--    facturas are untouched, and it can be reactivated.
--
-- 3. Two guards, the floor under the page's own checks:
--    - a clinic with appointments cannot be deleted at all; archive it.
--      Skipped when the account itself is going (an account delete cascades
--      through clinics, and by then the account row is already gone).
--    - a clinic with appointments still ahead cannot be archived: those
--      patients would be left booked at a location that no longer shows
--      anywhere.
--
-- 4. The plan's location cap counts ACTIVE clinics, and now also fires when
--    an archived clinic is reactivated -- otherwise archive, add, reactivate
--    walks straight past it.

alter table public.clinics add column phone text;
alter table public.clinics add column email text;
alter table public.clinics add column archived_at timestamptz;

-- ---------------------------------------------------------------- the cap
create or replace function public.enforce_clinic_location_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowance integer;
  v_in_use integer;
begin
  -- An update only matters when it brings an archived clinic back.
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;
  end if;
  -- Inserting one already archived takes no place.
  if tg_op = 'INSERT' and new.archived_at is not null then
    return new;
  end if;

  v_allowance := clinic_location_allowance(new.account_id);
  if v_allowance is null then
    return new;
  end if;

  select count(*) into v_in_use
  from clinics
  where account_id = new.account_id and archived_at is null and id <> new.id;

  if v_in_use >= v_allowance then
    -- PT402 -> HTTP 402, same convention as enforce_practitioner_seats
    -- (0150) -- lets the client tell a plan limit apart from a plain
    -- validation error (23514/400).
    raise exception using
      errcode = 'PT402',
      message = format(
        'Your plan covers %s clinic location(s) and all of them are in use. Upgrade your plan to add another location.',
        v_allowance
      );
  end if;

  return new;
end;
$function$;

revoke execute on function public.enforce_clinic_location_cap() from public, anon, authenticated;

drop trigger if exists enforce_clinic_location_cap on public.clinics;
create trigger enforce_clinic_location_cap
  before insert or update of archived_at on public.clinics
  for each row execute function public.enforce_clinic_location_cap();

-- ---------------------------------------------------------------- archive
create or replace function public.guard_clinic_archive()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (
      select 1 from appointments a
      where a.clinic_id = new.id and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show') and a.starts_at > now()
    ) then
      raise exception using
        errcode = '23514',
        message = 'This clinic still has upcoming appointments. Move or cancel them before archiving it.';
    end if;
    if not exists (
      select 1 from clinics c
      where c.account_id = new.account_id and c.id <> new.id and c.archived_at is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'This is the only active clinic. Add or reactivate another before archiving it.';
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_clinic_archive() from public, anon, authenticated;

drop trigger if exists guard_clinic_archive on public.clinics;
create trigger guard_clinic_archive
  before update of archived_at on public.clinics
  for each row execute function public.guard_clinic_archive();

-- ---------------------------------------------------------------- delete
create or replace function public.guard_clinic_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The account is being deleted and is taking its clinics with it.
  if not exists (select 1 from accounts where id = old.account_id) then
    return old;
  end if;
  if exists (select 1 from appointments where clinic_id = old.id) then
    raise exception using
      errcode = '23503',
      message = 'This clinic has appointments, so it cannot be deleted. Archive it instead: its history is kept.';
  end if;
  if not exists (
    select 1 from clinics c
    where c.account_id = old.account_id and c.id <> old.id and c.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'This is the only active clinic, so it cannot be deleted.';
  end if;
  return old;
end;
$function$;

revoke execute on function public.guard_clinic_delete() from public, anon, authenticated;

drop trigger if exists guard_clinic_delete on public.clinics;
create trigger guard_clinic_delete
  before delete on public.clinics
  for each row execute function public.guard_clinic_delete();

-- ---------------------------------------------------------------- bootstrap
-- 20260923174910's text; the only change is archived_at is null on clinics,
-- which is what takes an archived clinic out of the switcher.
create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
      and public.mfa_satisfied()
    limit 1
  )
  select case
    when not exists (select 1 from me) then jsonb_build_object('team_member', null)
    else (
      select jsonb_build_object(
        'team_member', to_jsonb(me.*),
        'account', (
          select to_jsonb(a) from (
            select name, slug, whatsapp_confirmation_template_name,
                   whatsapp_recall_template_name, scheduling_policy_fee_cents,
                   default_phone_country, require_two_factor
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id and archived_at is null
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at, growth_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;


-- ---------------------------------------------------------------- booking
-- 20260914095551's text; phone and email join each clinic, and an archived
-- clinic is left out even if online_booking_enabled was never turned off.
create or replace function get_public_booking_info(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        'online_booking_success_url', a.online_booking_success_url,
        'online_booking_primary_color', a.online_booking_primary_color,
        'online_booking_secondary_color', a.online_booking_secondary_color,
        'online_booking_background_color', a.online_booking_background_color,
        'online_booking_hide_logo', a.online_booking_hide_logo,
        'default_phone_country', a.default_phone_country,
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
        'logo_storage_path', c.logo_storage_path, 'phone', c.phone, 'email', c.email
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
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
$function$;

