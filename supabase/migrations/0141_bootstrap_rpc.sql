-- Every route change goes through middleware/account.global.ts, which blocks
-- navigation on the account store's load(). That load was two serial network
-- round-trips: fetch team_members to learn account_id, and only then fetch
-- account/clinics/permissions/subscription. Nothing else in the app -- page
-- queries, sidebar badges, the Billing tab -- can start until both finish,
-- which is why unrelated things all appear to finish loading at the same
-- moment: they're not waiting on each other, they're all waiting on this.
--
-- This returns the same five things in one call, deriving the team member
-- from auth.uid() so the second hop isn't needed.
--
-- SECURITY DEFINER with no account parameter is deliberate: the caller can't
-- name an account to read, it's resolved from their own JWT, so this can't
-- be pointed at someone else's data. Mirrors get_my_permissions, whose
-- owner/role logic is reused verbatim below rather than reimplemented.
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
                   whatsapp_recall_template_name, scheduling_policy_fee_cents
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
