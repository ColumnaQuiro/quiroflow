-- The Inbox list from a table of one row per conversation, instead of from
-- every message ever sent, every time.
--
-- inbox_conversations (20260924190000, last redefined in 20261010160300)
-- worked each conversation out from scratch on every read: every WhatsApp and
-- in-app message, grouped, the newest of each picked, then joined to each
-- person's reads, snoozes, archives and labels. ~260-450 ms on the largest
-- account with 5,700 messages, growing with every message, and run for the
-- list, the counts, the badge and each refresh after a message arrives.
--
-- Now:
--
-- 1. inbox_conversation_heads holds what the view used to compute -- the
--    newest message, when they last wrote, the number -- one row per
--    conversation, kept current by triggers on both message tables. A Growth
--    account's lead messages (lead_id set, no patient) are kept apart in
--    their own row (lead_only), so the view can still include them or not as
--    the account's tier says at read time, exactly as before.
--
-- 2. The view reads that table, and asks who I am once per query (an
--    InitPlan) rather than once per conversation per table: the per-person
--    tables' policies called is_account_member, has_permission and
--    current_team_member_id -- security definer functions Postgres cannot fold
--    into a plan -- for every row they looked at. Their policies are the same
--    rule, written so it is evaluated once.
--
-- Measured against production in a rolled-back transaction, as a signed-in
-- user: the same 391 rows, column for column, before and after; a page of
-- the list 118 ms -> 17 ms, the tab counts ~400 ms -> 8 ms.
--
-- inbox_unread_count (the nav badge) had its own copy of the whole
-- computation; it now counts the view, by the same rule.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table public.inbox_conversation_heads (
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_key text not null,
  lead_only boolean not null,
  patient_id uuid,
  phone_number text,
  external_contact_id text,
  last_message_id uuid not null,
  last_channel text not null,
  last_direction text not null,
  last_status text not null,
  last_body text,
  last_template_name text,
  last_media_type text,
  last_at timestamptz not null,
  last_inbound_at timestamptz,
  any_phone text,
  any_external_id text,
  primary key (account_id, conversation_key, lead_only)
);

-- Read as the messages it summarises are: staff with Inbox access to the
-- account. Written only by the triggers below.
alter table public.inbox_conversation_heads enable row level security;
create policy "staff read inbox_conversation_heads" on public.inbox_conversation_heads
  for select using (account_id in (select public.my_permitted_accounts('inbox_access')));
select public.require_two_factor_on('public.inbox_conversation_heads');
grant select on public.inbox_conversation_heads to authenticated;

-- What a refresh looks a conversation up by.
create index whatsapp_messages_inbox_key_idx
  on public.whatsapp_messages (account_id, (coalesce(patient_id::text, phone_number, external_contact_id, 'unknown')), created_at desc);

-- ---------------------------------------------------------------------------
-- Keeping it current
-- ---------------------------------------------------------------------------

-- One conversation's row(s), worked out again from its messages.
create or replace function public.refresh_inbox_head(p_account_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  key_patient uuid := case
    when p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_key::uuid
  end;
begin
  -- One refresh per conversation at a time, so two messages arriving together
  -- cannot each write a head that misses the other. Held to the end of the
  -- transaction; the statements below then see what the other committed.
  perform pg_advisory_xact_lock(hashtextextended('inbox_head:' || p_account_id::text || ':' || p_key, 0));

  delete from inbox_conversation_heads where account_id = p_account_id and conversation_key = p_key;

  insert into inbox_conversation_heads (
    account_id, conversation_key, lead_only, patient_id, phone_number, external_contact_id,
    last_message_id, last_channel, last_direction, last_status, last_body, last_template_name, last_media_type,
    last_at, last_inbound_at, any_phone, any_external_id
  )
  select distinct on (lead_only)
    p_account_id, p_key, lead_only, patient_id, phone_number, external_contact_id,
    id, channel, direction, status, body, template_name, media_type,
    created_at,
    max(created_at) filter (where direction = 'inbound') over w,
    max(phone_number) over w,
    max(external_contact_id) over w
  from (
    select m.id, (m.lead_id is not null and m.patient_id is null) as lead_only, m.patient_id, m.phone_number, m.external_contact_id,
           m.channel, m.direction, m.status, m.body_preview as body, m.template_name, m.media_type, m.created_at
      from whatsapp_messages m
     where m.account_id = p_account_id
       and coalesce(m.patient_id::text, m.phone_number, m.external_contact_id, 'unknown') = p_key
    union all
    select a.id, false, a.patient_id, null, null, 'in_app', a.direction, 'sent', a.body, null, null, a.created_at
      from patient_app_messages a
     where a.account_id = p_account_id and a.patient_id = key_patient
  ) msgs
  window w as (partition by lead_only)
  order by lead_only, created_at desc;
end;
$function$;

revoke all on function public.refresh_inbox_head(uuid, text) from public, anon, authenticated;

create or replace function public.whatsapp_messages_refresh_inbox_head()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_key text;
  new_key text;
begin
  if tg_op <> 'INSERT' then old_key := coalesce(old.patient_id::text, old.phone_number, old.external_contact_id, 'unknown'); end if;
  if tg_op <> 'DELETE' then new_key := coalesce(new.patient_id::text, new.phone_number, new.external_contact_id, 'unknown'); end if;

  -- A delivery receipt (three or four per message sent) or an edit: still the
  -- same conversation, so at most the head's own columns change.
  if tg_op = 'UPDATE'
     and old.account_id = new.account_id and old_key = new_key
     and (old.lead_id is not null and old.patient_id is null) = (new.lead_id is not null and new.patient_id is null)
     and old.created_at = new.created_at and old.direction = new.direction and old.channel = new.channel then
    update inbox_conversation_heads
       set last_status = new.status, last_body = new.body_preview, last_template_name = new.template_name, last_media_type = new.media_type
     where account_id = new.account_id and conversation_key = new_key and last_message_id = new.id
       and (last_status, last_body, last_template_name, last_media_type)
           is distinct from (new.status, new.body_preview, new.template_name, new.media_type);
    return null;
  end if;

  -- Moved conversation (linked to a patient, a lead converted, patients
  -- merged), arrived, or deleted: both ends worked out again, in a fixed order
  -- so two transactions moving messages between the same two never deadlock.
  if tg_op = 'UPDATE' and (old.account_id, old_key) is distinct from (new.account_id, new_key) then
    if (old.account_id::text || old_key) < (new.account_id::text || new_key) then
      perform refresh_inbox_head(old.account_id, old_key);
      perform refresh_inbox_head(new.account_id, new_key);
    else
      perform refresh_inbox_head(new.account_id, new_key);
      perform refresh_inbox_head(old.account_id, old_key);
    end if;
  elsif tg_op = 'DELETE' then
    perform refresh_inbox_head(old.account_id, old_key);
  else
    perform refresh_inbox_head(new.account_id, new_key);
  end if;
  return null;
end;
$function$;

create trigger whatsapp_messages_refresh_inbox_head
  after insert or update or delete on public.whatsapp_messages
  for each row execute function public.whatsapp_messages_refresh_inbox_head();

create or replace function public.patient_app_messages_refresh_inbox_head()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op <> 'INSERT' then perform refresh_inbox_head(old.account_id, old.patient_id::text); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or (old.account_id, old.patient_id) is distinct from (new.account_id, new.patient_id)) then
    perform refresh_inbox_head(new.account_id, new.patient_id::text);
  end if;
  return null;
end;
$function$;

create trigger patient_app_messages_refresh_inbox_head
  after insert or update or delete on public.patient_app_messages
  for each row execute function public.patient_app_messages_refresh_inbox_head();

-- Every conversation there is. After the triggers, and in the same
-- transaction: creating them locks both tables against writes until this
-- commits, so nothing arrives between the two and nothing is missed.
insert into public.inbox_conversation_heads (
  account_id, conversation_key, lead_only, patient_id, phone_number, external_contact_id,
  last_message_id, last_channel, last_direction, last_status, last_body, last_template_name, last_media_type,
  last_at, last_inbound_at, any_phone, any_external_id
)
select distinct on (account_id, conversation_key, lead_only)
  account_id, conversation_key, lead_only, patient_id, phone_number, external_contact_id,
  id, channel, direction, status, body, template_name, media_type,
  created_at,
  max(created_at) filter (where direction = 'inbound') over w,
  max(phone_number) over w,
  max(external_contact_id) over w
from (
  select m.account_id, coalesce(m.patient_id::text, m.phone_number, m.external_contact_id, 'unknown') as conversation_key,
         (m.lead_id is not null and m.patient_id is null) as lead_only,
         m.id, m.patient_id, m.phone_number, m.external_contact_id, m.channel, m.direction, m.status,
         m.body_preview as body, m.template_name, m.media_type, m.created_at
    from public.whatsapp_messages m
  union all
  select a.account_id, a.patient_id::text, false, a.id, a.patient_id, null, null, 'in_app', a.direction, 'sent', a.body, null, null, a.created_at
    from public.patient_app_messages a
) msgs
window w as (partition by account_id, conversation_key, lead_only)
order by account_id, conversation_key, lead_only, created_at desc
on conflict (account_id, conversation_key, lead_only) do nothing;

-- ---------------------------------------------------------------------------
-- Who I am, once per query
-- ---------------------------------------------------------------------------

-- My team memberships that carry Inbox access: the account and the team
-- member I am in it. The rule the per-person policies spelled out with three
-- functions per row (is_account_member, has_permission,
-- current_team_member_id), as one set Postgres reads once.
create or replace function public.my_inbox_members()
returns table (account_id uuid, team_member_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id, tm.id
    from team_members tm
   where tm.user_id = auth.uid() and tm.deleted_at is null
     and has_permission(tm.account_id, 'inbox_access');
$function$;

revoke all on function public.my_inbox_members() from public, anon;
grant execute on function public.my_inbox_members() to authenticated;

alter policy "staff manage own inbox_reads" on public.inbox_reads
  using ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m))
  with check ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m));
alter policy "staff manage own inbox_snoozes" on public.inbox_snoozes
  using ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m))
  with check ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m));
alter policy "staff manage own whatsapp_conversation_archives" on public.whatsapp_conversation_archives
  using ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m))
  with check ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m));
alter policy "staff manage own whatsapp_conversation_labels" on public.whatsapp_conversation_labels
  using ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m))
  with check ((account_id, team_member_id) in (select m.account_id, m.team_member_id from public.my_inbox_members() m));
alter policy "staff manage inbox_assignments" on public.inbox_assignments
  using (account_id in (select m.account_id from public.my_inbox_members() m))
  with check (account_id in (select m.account_id from public.my_inbox_members() m));

-- ---------------------------------------------------------------------------
-- The view and the badge
-- ---------------------------------------------------------------------------

-- Same columns, same meaning (see 20261010160300 for each one's rule).
create or replace view public.inbox_conversations
  with (security_invoker = true)
  as
  with me as (
    select m.account_id, m.team_member_id from public.my_inbox_members() m
  ),
  included as (
    select h.* from inbox_conversation_heads h
     where not h.lead_only or h.account_id not in (select public.inbox_growth_account_ids())
  ),
  heads as (
    select distinct on (account_id, conversation_key) *
      from included
     order by account_id, conversation_key, last_at desc
  ),
  facts as (
    select account_id, conversation_key,
           max(last_inbound_at) as last_inbound_at,
           max(any_phone) as any_phone,
           max(any_external_id) as any_external_id
      from included
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
    h.last_channel,
    h.last_direction,
    h.last_status,
    h.last_body,
    h.last_template_name,
    h.last_media_type,
    h.last_at,
    f.last_inbound_at,
    ia.team_member_id as assigned_to,
    r.last_read_at as my_last_read_at,
    ((h.last_direction = 'inbound' and (r.last_read_at is null or r.last_read_at < h.last_at))
      or coalesce(r.last_read_at = 'epoch'::timestamptz, false)
      or (s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until))) as unread_for_me,
    (ar.conversation_key is not null) as my_archived,
    coalesce(lb.label_ids, '{}'::uuid[]) as my_label_ids,
    case when s.snoozed_until > now() and (f.last_inbound_at is null or f.last_inbound_at <= s.created_at)
         then s.snoozed_until end as my_snoozed_until,
    coalesce(s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until), false) as my_follow_up,
    case when s.snoozed_until <= now() and (r.last_read_at is null or r.last_read_at < s.snoozed_until)
         then greatest(h.last_at, s.snoozed_until) else h.last_at end as my_sort_at
  from heads h
  join facts f on f.account_id = h.account_id and f.conversation_key = h.conversation_key
  left join me on me.account_id = h.account_id
  left join patients p on p.id = h.patient_id
  left join inbox_assignments ia on ia.account_id = h.account_id and ia.conversation_key = h.conversation_key
  left join inbox_reads r on r.team_member_id = me.team_member_id and r.conversation_key = h.conversation_key
  left join inbox_snoozes s on s.team_member_id = me.team_member_id and s.conversation_key = h.conversation_key
  left join whatsapp_conversation_archives ar on ar.team_member_id = me.team_member_id and ar.conversation_key = h.conversation_key
  left join lateral (
    select array_agg(cl.label_id) as label_ids
      from whatsapp_conversation_labels cl
     where cl.team_member_id = me.team_member_id and cl.conversation_key = h.conversation_key
  ) lb on true;

grant select on public.inbox_conversations to authenticated;

-- The badge: unread for me, not archived, not snoozed out of sight -- which
-- is what the old function's two counts added up to, follow-ups included.
create or replace function public.inbox_unread_count()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select count(*)::integer
    from inbox_conversations
   where unread_for_me and not my_archived and my_snoozed_until is null;
$function$;
