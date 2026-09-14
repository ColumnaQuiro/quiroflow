-- Where a phone number's country comes from when nobody has said.
--
-- Every place the app creates a contact number defaulted to 'ES', which is
-- right for the first clinic and wrong for every clinic after it. The
-- PracticeHub import made that visible: it stamped 'ES' on all 1,510
-- imported numbers, 90 of which were foreign, so a US patient's number
-- rendered as "+34 (303) 710-5245" and a WhatsApp to it would have reached
-- a Spanish stranger. That import now reads each number's real country from
-- PracticeHub's API -- but the fallback, the manual "add a number" field,
-- the new-patient forms and the public booking page were all still hardcoded
-- to Spain.
--
-- So the account carries its own default. Existing accounts keep 'ES', which
-- is what they have been using all along; a new clinic picks its country
-- during onboarding.
alter table accounts
  add column if not exists default_phone_country text not null default 'ES';

-- Two letters, uppercase -- the shape utils/countries.ts looks up. A bad
-- value there would fall through to "no dial code", which shows numbers
-- bare; harmless, but worth refusing at the door.
alter table accounts
  drop constraint if exists accounts_default_phone_country_format;
alter table accounts
  add constraint accounts_default_phone_country_format
  check (default_phone_country ~ '^[A-Z]{2}$');

-- The account's default reaches the app through the bootstrap call.
create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
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
                   default_phone_country
            from accounts where id = me.account_id
          ) a
        ),
        'clinics', coalesce((
          select jsonb_agg(to_jsonb(c)) from (
            select id, account_id, name, address, slot_duration_minutes,
                   business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path
            from clinics where account_id = me.account_id
          ) c
        ), '[]'::jsonb),
        'permissions', coalesce(get_my_permissions(me.account_id), '{}'::jsonb),
        'subscription', (
          select to_jsonb(s) from (
            select status, trial_ends_at
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;

revoke all on function public.get_my_bootstrap() from public;
grant execute on function public.get_my_bootstrap() to authenticated;

-- ...and through the public booking payload, so a clinic's own booking page
-- offers its country rather than Spain's to the patients typing into it.
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
$function$;

revoke all on function get_public_booking_info(text) from public;
grant execute on function get_public_booking_info(text) to anon, authenticated;

-- Onboarding asks for the country and passes it here. The old four-argument
-- signature is dropped rather than left beside this one: with both present,
-- a four-argument call matches both and Postgres refuses it as ambiguous.
drop function if exists public.create_account_with_owner(text, text, text, text);

create or replace function public.create_account_with_owner(
  p_account_name text,
  p_clinic_name text,
  p_owner_name text default null::text,
  p_referred_by_slug text default null::text,
  p_default_phone_country text default 'ES'
)
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
  v_referred_by_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from team_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an account';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- A stale or malformed referral slug from the signup URL must not break
  -- account creation -- look it up and silently ignore if it doesn't
  -- resolve to a real account, rather than failing the whole signup.
  if p_referred_by_slug is not null then
    select id into v_referred_by_account_id from accounts where slug = p_referred_by_slug;
  end if;

  insert into accounts (name, slug, referred_by_account_id, default_phone_country)
    values (p_account_name, generate_unique_account_slug(p_account_name), v_referred_by_account_id,
            coalesce(nullif(upper(trim(p_default_phone_country)), ''), 'ES'))
    returning id into v_account_id;
  insert into clinics (account_id, name) values (v_account_id, p_clinic_name) returning id into v_clinic_id;
  insert into calendar_resources (account_id, clinic_id, name)
    values (v_account_id, v_clinic_id, 'Room 1');
  insert into subscriptions (account_id, plan_id, status, trial_ends_at)
    values (v_account_id, 'starter', 'trialing', now() + interval '30 days');

  v_owner_role_id := seed_account_roles(v_account_id);

  insert into team_members (account_id, user_id, full_name, role, role_id, is_owner, is_practitioner)
    values (v_account_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), v_email, 'Owner'), 'owner', v_owner_role_id, true, true)
    returning id into v_team_member_id;
  insert into team_member_clinics (team_member_id, clinic_id) values (v_team_member_id, v_clinic_id);

  return query select v_account_id, v_clinic_id;
end;
$function$;

revoke all on function public.create_account_with_owner(text, text, text, text, text) from public;
grant execute on function public.create_account_with_owner(text, text, text, text, text) to authenticated;
