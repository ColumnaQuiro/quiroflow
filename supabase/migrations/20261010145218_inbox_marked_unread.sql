-- "Mark as unread" works whoever wrote last.
--
-- Both Inboxes mark a conversation unread by writing a read time of the
-- epoch (new Date(0)) to inbox_reads. Unread, though, has only ever meant
-- "the last message is theirs and I have not read it since", so the epoch
-- did something only when they had written last. On a conversation the
-- clinic answered last -- the usual one to want to come back to -- the
-- button did nothing at all, on web and in the app, and said nothing.
--
-- The epoch now means what the button says: unread for me, until I open it
-- again, which writes the current time over it. No new column, because the
-- value is already what every client writes, including app versions
-- already in the stores; they get the new behaviour on the badge without
-- an update.
--
-- The view and the badge are redefined from 20260930142159 with only the
-- unread condition changed: same columns in the same order, same
-- security_invoker, same grants.

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
    -- Marked unread by hand (the epoch), whoever wrote last. Coalesced: with
    -- no read row at all the comparison is null, and so would the column be.
    ((h.direction = 'inbound' and (r.last_read_at is null or r.last_read_at < h.created_at))
      or coalesce(r.last_read_at = 'epoch'::timestamptz, false)) as unread_for_me,
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

-- The badge, with the same rule as the view above.
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
  where (
      h.direction = 'inbound'
      -- unread_for_me: no read of mine at or after the last message (a read
      -- row with no timestamp counts as unread, as it does in the view)
      and not exists (
        select 1 from inbox_reads r
        where r.team_member_id = current_team_member_id(h.account_id)
          and r.conversation_key = h.conversation_key
          and r.last_read_at >= h.created_at
      )
      -- or marked unread by hand, whoever wrote last
      or exists (
        select 1 from inbox_reads r
        where r.team_member_id = current_team_member_id(h.account_id)
          and r.conversation_key = h.conversation_key
          and r.last_read_at = 'epoch'::timestamptz
      )
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
