-- The Inbox badge, and reading messages at all, without per-row permission
-- checks.
--
-- The sidebar's Inbox badge was the slowest request on EVERY page -- 0.6 to
-- 2.3 s in production -- because it counted rows of inbox_conversations, a
-- view that builds every conversation the clinic has ever had before the
-- badge's "unread, not archived" filter can apply. Two things made that slow,
-- and this fixes both without changing what anything returns.
--
-- 1. The staff read policies on whatsapp_messages and patient_app_messages
--    called is_account_member(account_id) and has_permission(account_id,
--    'inbox_access') for EVERY ROW -- two security-definer lookups per
--    message, 7,000+ calls to count one badge. Rewritten as
--    `account_id in (select my_permitted_accounts('inbox_access'))`, which
--    Postgres evaluates once per query and hashes.
--
--    The same rows, exactly. has_permission(a, p) is only true when the
--    caller has a live team_members row in `a` (owner, or a role granting
--    p), and that row already makes is_account_member(a) true -- so the old
--    predicate was has_permission(a, 'inbox_access') alone.
--    my_permitted_accounts(p) is, by its definition, the accounts where the
--    caller has a live team_members row AND has_permission(account, p): the
--    same set. The patient-facing and service-role policies, the write
--    policies and the restrictive two-factor policy are untouched.
--
--    This speeds up everything that reads messages, not just the badge: the
--    Inbox page (web and mobile), the scheduled-reminders report and the
--    lead threads.
--
-- 2. inbox_unread_count(): the badge as one number, computed the way the
--    view computes unread_for_me and my_archived -- a conversation is keyed
--    exactly as the view keys it, its last message is its latest across
--    WhatsApp/Instagram and the patient app, and it counts when that message
--    is inbound, newer than MY inbox_reads.last_read_at (or I have never read
--    it) and I have not archived it. It skips everything the view computes
--    for the list and the badge never needed (names, phone numbers, previews,
--    assignment, labels, per-conversation facts). SECURITY INVOKER: every
--    table it reads applies the caller's own row-level security, including
--    two-factor, just as the view does. The view itself is unchanged.

alter policy "staff read whatsapp_messages" on public.whatsapp_messages
  using (account_id in (select public.my_permitted_accounts('inbox_access')));

alter policy "staff read patient_app_messages" on public.patient_app_messages
  using (account_id in (select public.my_permitted_accounts('inbox_access')));

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
    where (m.lead_id is null or m.patient_id is not null)
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
