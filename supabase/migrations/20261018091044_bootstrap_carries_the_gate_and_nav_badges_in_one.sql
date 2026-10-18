-- Two round trips fewer on every page the staff open.
--
-- 1. get_my_bootstrap() now says whether the second factor is pending, so the
--    web middleware no longer asks get_my_two_factor_gate() first and the
--    bootstrap second -- two serial requests before any page could start its
--    own. Under a pending factor it returns only {two_factor: 'verify'|'enroll'}:
--    mfa_satisfied() hides the team member anyway, and the caller must not
--    read "no team member" as "send them to onboarding" (middleware/account.global.ts).
--    get_my_two_factor_gate() stays for the pages that call it on their own
--    (/two-factor, /login, the app's useIdentity).
--
-- 2. get_nav_badges() answers the sidebar's four counters and the help
--    widget's unread dot in one request. They were five separate ones --
--    recalls, automations, inbox unread, today's visits, support unread --
--    fired together on every navigation, and on production's two-core
--    database requests fired together queue behind each other: the Inbox
--    view answers in 44 ms when it is alone and 92 ms when four requests
--    arrive in the same second (edge logs, 17-18 Oct 2026). Security invoker,
--    so every count sees exactly what the caller's own policies allow.

create or replace function public.get_my_bootstrap()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with gate as (
    select public.get_my_two_factor_gate() as g
  ),
  me as (
    select tm.id, tm.account_id, tm.full_name, tm.role, tm.color, tm.is_owner,
           tm.theme_preference, tm.language_preference, tm.photo_storage_path
    from team_members tm
    where tm.user_id = auth.uid() and tm.deleted_at is null
      and public.mfa_satisfied()
    limit 1
  )
  select case
    when (select g from gate) <> 'ok' then jsonb_build_object('two_factor', (select g from gate), 'team_member', null)
    when not exists (select 1 from me) then jsonb_build_object('two_factor', 'ok', 'team_member', null)
    else (
      select jsonb_build_object(
        'two_factor', 'ok',
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
            select status, trial_ends_at, growth_addon, receptionist_addon, plan_id, comped,
                   stripe_subscription_id is not null as has_stripe_subscription
            from subscriptions where account_id = me.account_id
          ) s
        )
      )
      from me
    )
  end;
$function$;

-- p_clinic_id: the clinic on screen (today's visits are counted there; null
-- counts every clinic). p_recalls_clinic_id: null on a single-clinic account,
-- where the recalls badge counts the whole account; on a multi-clinic one the
-- clinic on screen plus patients with no clinic, the way /recalls lists them.
-- p_with_recalls false leaves 'recalls' null and the sidebar keeps the number
-- it has: that count walks every appointment the account has, so the sidebar
-- asks for it on its own, longer clock.
create or replace function public.get_nav_badges(
  p_team_member_id uuid,
  p_clinic_id uuid,
  p_recalls_clinic_id uuid,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_with_recalls boolean
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'my_day', (
      select count(*) from appointments a
      where a.practitioner_id = p_team_member_id
        and a.status <> 'cancelled' and a.deleted_at is null
        and a.starts_at >= p_day_start and a.starts_at < p_day_end
        and (p_clinic_id is null or a.clinic_id = p_clinic_id)
    ),
    'automations_active', exists (select 1 from automation_rules r where r.enabled),
    'inbox_unread', public.inbox_unread_count(),
    'support_unread', coalesce((
      select c.clinic_unread from support_conversations c
      order by c.last_message_at desc limit 1
    ), false),
    'recalls', case when p_with_recalls then (
      select count(*) from recall_candidates rc
      where rc.days_since_last_appointment >= 21
        and (p_recalls_clinic_id is null or rc.clinic_id = p_recalls_clinic_id or rc.clinic_id is null)
    ) end
  );
$function$;

revoke all on function public.get_nav_badges(uuid, uuid, uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.get_nav_badges(uuid, uuid, uuid, timestamptz, timestamptz, boolean) to authenticated;
