-- Lead messages in the Inbox of a clinic without Growth.
--
-- Every WhatsApp sender who matches no patient becomes a lead
-- (leadForWhatsAppSender), and so does every Instagram DM
-- (leadForInstagramSender). Their messages are stored with lead_id set and
-- patient_id null -- and inbox_conversations and inbox_unread_count both
-- leave exactly those rows out, because Growth draws lead threads itself,
-- from /api/growth/conversations. That endpoint is behind requireGrowth, so
-- for a clinic without Growth the messages went nowhere: no row in the
-- Inbox, nothing on the badge, nothing to reply to. A stranger's first
-- WhatsApp and every Instagram DM, silently.
--
-- The fix is to leave lead messages out only where something else shows
-- them. For an account without Growth they are kept, and keyed the way the
-- view has always keyed a message with no patient -- by phone number, else
-- by Instagram id -- which is the "number that is not on any patient"
-- conversation the Inbox already knows how to show, answer and link to a
-- patient (InboxUnknownPanel, link_inbox_conversation). Nothing about a
-- Growth account changes: its lead messages are still left out here and
-- drawn by Growth.
--
-- Deciding it here rather than in the browser, because the badge is one
-- number the database computes and must agree with the list.
--
-- inbox_growth_account_ids() is requireGrowth's hasGrowth() in SQL, and the
-- two have to stay in step (utils/growthPlans.ts says so too). If they
-- drift, the failure is visible rather than silent: a Growth clinic this
-- calls non-Growth sees a lead twice (as a lead row and as a number), and
-- the reverse is the bug this migration fixes. SECURITY INVOKER: the caller
-- sees only their own accounts' subscriptions, the same row-level security
-- the view already runs under. Several subscription rows for one account
-- mean no Growth, as they do in requireActiveAccount.
--
-- The view is redefined with the same columns in the same order, the same
-- security_invoker option and the same grants; only the msgs filter changes.

create or replace function public.inbox_growth_account_ids()
returns setof uuid
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select s.account_id
  from subscriptions s
  group by s.account_id
  having count(*) = 1
     and bool_and(
       s.comped
       or s.status = 'trialing'
       -- PLANS_INCLUDING_GROWTH in utils/growthPlans.ts
       or ((s.growth_addon or s.plan_id in ('clinic')) and s.status not in ('locked', 'canceled'))
     );
$function$;

revoke all on function public.inbox_growth_account_ids() from public, anon;
grant execute on function public.inbox_growth_account_ids() to authenticated;

create or replace view public.inbox_conversations
  with (security_invoker = true)
  as
  with msgs as (
    select m.account_id,
           coalesce(m.patient_id::text, m.phone_number, m.external_contact_id, 'unknown') as conversation_key,
           m.patient_id, m.phone_number, m.external_contact_id, m.channel, m.direction, m.status,
           m.body_preview, m.template_name, m.media_type, m.created_at
    from whatsapp_messages m
    where m.lead_id is null
       or m.patient_id is not null
       or m.account_id not in (select public.inbox_growth_account_ids())
    union all
    select a.account_id, a.patient_id::text, a.patient_id, null, null, 'in_app', a.direction, 'sent',
           a.body, null, null, a.created_at
    from patient_app_messages a
  ),
  heads as (
    select distinct on (account_id, conversation_key) *
    from msgs
    order by account_id, conversation_key, created_at desc
  ),
  facts as (
    select account_id, conversation_key,
           max(created_at) filter (where direction = 'inbound') as last_inbound_at,
           max(phone_number) as any_phone,
           max(external_contact_id) as any_external_id
    from msgs
    group by account_id, conversation_key
  )
  select
    h.account_id,
    h.conversation_key,
    h.patient_id,
    coalesce(h.phone_number, f.any_phone) as phone_number,
    coalesce(h.external_contact_id, f.any_external_id) as external_contact_id,
    p.first_name,
    p.last_name,
    p.search_name,
    h.channel as last_channel,
    h.direction as last_direction,
    h.status as last_status,
    h.body_preview as last_body,
    h.template_name as last_template_name,
    h.media_type as last_media_type,
    h.created_at as last_at,
    f.last_inbound_at,
    ia.team_member_id as assigned_to,
    r.last_read_at as my_last_read_at,
    (h.direction = 'inbound' and (r.last_read_at is null or r.last_read_at < h.created_at)) as unread_for_me,
    exists (
      select 1 from whatsapp_conversation_archives ar
      where ar.team_member_id = current_team_member_id(h.account_id) and ar.conversation_key = h.conversation_key
    ) as my_archived,
    coalesce((
      select array_agg(cl.label_id) from whatsapp_conversation_labels cl
      where cl.team_member_id = current_team_member_id(h.account_id) and cl.conversation_key = h.conversation_key
    ), '{}'::uuid[]) as my_label_ids
  from heads h
  join facts f on f.account_id = h.account_id and f.conversation_key = h.conversation_key
  left join patients p on p.id = h.patient_id
  left join inbox_assignments ia on ia.account_id = h.account_id and ia.conversation_key = h.conversation_key
  left join inbox_reads r on r.team_member_id = current_team_member_id(h.account_id) and r.conversation_key = h.conversation_key;

grant select on public.inbox_conversations to authenticated;

-- The badge, with the same filter as the view above and otherwise unchanged
-- from 20260928153512.
create or replace function public.inbox_unread_count()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with mine as (
    select public.my_permitted_accounts('inbox_access') as account_id
  ),
  msgs as (
    select m.account_id,
           coalesce(m.patient_id::text, m.phone_number, m.external_contact_id, 'unknown') as conversation_key,
           m.direction, m.created_at
    from whatsapp_messages m
    where (m.lead_id is null
           or m.patient_id is not null
           or m.account_id not in (select public.inbox_growth_account_ids()))
      and m.account_id in (select account_id from mine)
    union all
    select a.account_id, a.patient_id::text, a.direction, a.created_at
    from patient_app_messages a
    where a.account_id in (select account_id from mine)
  ),
  heads as (
    select distinct on (account_id, conversation_key) account_id, conversation_key, direction, created_at
    from msgs
    order by account_id, conversation_key, created_at desc
  )
  select count(*)::integer
  from heads h
  where h.direction = 'inbound'
    -- unread_for_me: no read of mine at or after the last message (a read
    -- row with no timestamp counts as unread, as it does in the view)
    and not exists (
      select 1 from inbox_reads r
      where r.team_member_id = current_team_member_id(h.account_id)
        and r.conversation_key = h.conversation_key
        and r.last_read_at >= h.created_at
    )
    -- not my_archived
    and not exists (
      select 1 from whatsapp_conversation_archives ar
      where ar.team_member_id = current_team_member_id(h.account_id)
        and ar.conversation_key = h.conversation_key
    );
$function$;

revoke all on function public.inbox_unread_count() from public, anon;
grant execute on function public.inbox_unread_count() to authenticated;
