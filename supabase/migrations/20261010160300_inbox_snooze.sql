-- Snooze: hide a conversation from my Inbox until a time, and have it come
-- back then as a follow-up.
--
-- Per person, like archiving and reading (inbox_reads,
-- whatsapp_conversation_archives): my snooze is not my colleague's. One row
-- per person and conversation; snoozing again moves the time.
--
-- Out of sight while the time has not come AND they have not written since
-- it was snoozed -- a reply brings it straight back, as it should. Once the
-- time passes it is a follow-up: unread for me, marked, and at the top of my
-- list (my_sort_at), until I open it. Opening already writes inbox_reads, so
-- "not read since it came due" is all it takes; no client has to clear the
-- row, which is what keeps the app versions already in the stores right:
-- they do not know about snoozing, show snoozed conversations as before, and
-- clear a follow-up by opening it like any other.
--
-- The view and the badge are redefined from 20261010145218 with three
-- columns added at the end and the follow-up added to unread; nothing else
-- changes.

create table public.inbox_snoozes (
  account_id uuid not null references public.accounts(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  conversation_key text not null,
  snoozed_until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (team_member_id, conversation_key)
);
create index inbox_snoozes_lookup_idx on public.inbox_snoozes (account_id, team_member_id);

alter table public.inbox_snoozes enable row level security;
create policy "staff manage own inbox_snoozes" on public.inbox_snoozes
  for all
  using (is_account_member(account_id) and has_permission(account_id, 'inbox_access') and team_member_id = current_team_member_id(account_id))
  with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access') and team_member_id = current_team_member_id(account_id));
select public.require_two_factor_on('public.inbox_snoozes');

grant select, insert, update, delete on public.inbox_snoozes to authenticated;

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
      or coalesce(r.last_read_at = 'epoch'::timestamptz, false)
      -- A follow-up that has come due, until it is opened.
      or (s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until))) as unread_for_me,
    exists (
      select 1 from whatsapp_conversation_archives ar
      where ar.team_member_id = current_team_member_id(h.account_id) and ar.conversation_key = h.conversation_key
    ) as my_archived,
    coalesce((
      select array_agg(cl.label_id) from whatsapp_conversation_labels cl
      where cl.team_member_id = current_team_member_id(h.account_id) and cl.conversation_key = h.conversation_key
    ), '{}'::uuid[]) as my_label_ids,
    -- Snoozed by me and still out of sight: the time has not come and they
    -- have not written since. Null otherwise.
    case when s.snoozed_until > now() and (f.last_inbound_at is null or f.last_inbound_at <= s.created_at)
         then s.snoozed_until end as my_snoozed_until,
    -- Come due and not opened since: back at the top, unread, marked.
    coalesce(s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until), false) as my_follow_up,
    -- What my list is ordered by: a follow-up comes back to the top at the
    -- time it was due, as if it had just been written.
    case when s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until)
         then greatest(h.created_at, s.snoozed_until) else h.created_at end as my_sort_at
  from heads h
  join facts f on f.account_id = h.account_id and f.conversation_key = h.conversation_key
  left join patients p on p.id = h.patient_id
  left join inbox_assignments ia on ia.account_id = h.account_id and ia.conversation_key = h.conversation_key
  left join inbox_reads r on r.team_member_id = current_team_member_id(h.account_id) and r.conversation_key = h.conversation_key
  left join inbox_snoozes s on s.team_member_id = current_team_member_id(h.account_id) and s.conversation_key = h.conversation_key;

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
  select (
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
    )
    -- not snoozed out of sight: snoozed until later, and nothing inbound
    -- since it was snoozed
    and not exists (
      select 1 from inbox_snoozes s
      where s.team_member_id = current_team_member_id(h.account_id)
        and s.conversation_key = h.conversation_key
        and s.snoozed_until > now()
        and not exists (
          select 1 from msgs m2
          where m2.account_id = h.account_id and m2.conversation_key = h.conversation_key
            and m2.direction = 'inbound' and m2.created_at > s.created_at
        )
    )
  ) + (
  -- plus follow-ups come due and not opened since (they count whoever wrote
  -- last, like a conversation marked unread by hand)
  select count(*)::integer
  from heads h
  join inbox_snoozes s on s.team_member_id = current_team_member_id(h.account_id) and s.conversation_key = h.conversation_key
  where s.snoozed_until <= now()
    and not exists (
      select 1 from inbox_reads r
      where r.team_member_id = current_team_member_id(h.account_id)
        and r.conversation_key = h.conversation_key
        and r.last_read_at >= s.snoozed_until
    )
    -- already counted above when unread anyway
    and not (
      (h.direction = 'inbound'
       and not exists (
         select 1 from inbox_reads r
         where r.team_member_id = current_team_member_id(h.account_id)
           and r.conversation_key = h.conversation_key
           and r.last_read_at >= h.created_at
       ))
      or exists (
        select 1 from inbox_reads r
        where r.team_member_id = current_team_member_id(h.account_id)
          and r.conversation_key = h.conversation_key
          and r.last_read_at = 'epoch'::timestamptz
      )
    )
    and not exists (
      select 1 from whatsapp_conversation_archives ar
      where ar.team_member_id = current_team_member_id(h.account_id)
        and ar.conversation_key = h.conversation_key
    )
  );
$function$;

revoke all on function public.inbox_unread_count() from public, anon;
grant execute on function public.inbox_unread_count() to authenticated;
