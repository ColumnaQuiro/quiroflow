-- The Inbox list, its tab counts and its "reply window closing" rows in one
-- request.
--
-- Opening the Inbox fired three requests at the inbox_conversations view at
-- once -- the page of rows, inbox_counts(), and the expiring rows -- beside
-- the sidebar's own unread count. On production's two-core database
-- requests fired together queue: the view answers in 44 ms when it is alone
-- and 92 ms when four arrive in the same second (edge logs, 17-18 Oct 2026).
-- Here the view is scanned once (a materialized CTE) and the three answers
-- are taken from that scan.
--
-- Security invoker: inbox_conversations is already scoped to the caller
-- (my_inbox_members), and this must see exactly what the caller sees.
--
-- Filters mirror pages/inbox.vue, each skipped when its parameter is null
-- or false. p_search_name is the normalised term for search_name,
-- p_search_phone the raw term for phone_number, p_search_keys the
-- conversation keys whose message text matched (the page finds those first).
-- p_window_from/to bound the reply-window warning, from the client's clock,
-- the same way the page computed them. p_limit 0 answers counts and the
-- expiring rows without a page of rows.
create or replace function public.inbox_page(
  p_view text,
  p_team_member_id uuid,
  p_tab text default 'all',
  p_unread_only boolean default false,
  p_expiring boolean default false,
  p_reply text default null,
  p_label_id uuid default null,
  p_search_name text default null,
  p_search_phone text default null,
  p_search_keys text[] default null,
  p_window_from timestamptz default null,
  p_window_to timestamptz default null,
  p_limit integer default 51,
  p_offset integer default 0,
  p_with_counts boolean default true,
  p_with_expiring boolean default true
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with base as materialized (
    select *
    from inbox_conversations c
    where c.my_archived = (p_view = 'archived')
      and case p_view
            when 'snoozed' then c.my_snoozed_until is not null
            when 'active' then c.my_snoozed_until is null
            else true
          end
  ),
  page as (
    select *
    from base b
    where (p_tab <> 'mine' or b.assigned_to = p_team_member_id)
      and (p_tab <> 'unassigned' or b.assigned_to is null)
      and (not p_unread_only or b.unread_for_me)
      and (not p_expiring or (
            b.last_direction = 'inbound'
            and b.last_channel in ('whatsapp', 'instagram')
            and b.last_at > p_window_from and b.last_at <= p_window_to))
      and (p_reply is null
           or (p_reply = 'awaiting_us' and b.last_direction = 'inbound')
           or (p_reply = 'awaiting_patient' and b.last_direction = 'outbound'))
      and (p_label_id is null or b.my_label_ids @> array[p_label_id])
      and (p_search_name is null
           or b.search_name ilike '%' || p_search_name || '%'
           or (p_search_phone is not null and b.phone_number ilike '%' || p_search_phone || '%')
           or (p_search_keys is not null and b.conversation_key = any (p_search_keys)))
    order by
      (case when p_view = 'snoozed' then b.my_snoozed_until end) asc nulls last,
      (case when p_expiring then b.last_at end) asc nulls last,
      b.my_sort_at desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  ),
  expiring as (
    select *
    from base b
    where p_with_expiring and p_view = 'active'
      and b.last_direction = 'inbound'
      and b.last_channel in ('whatsapp', 'instagram')
      and b.last_at > p_window_from and b.last_at <= p_window_to
    order by b.last_at asc
    limit 200
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'::jsonb),
    'counts', case when p_with_counts then (
      select jsonb_build_object(
        'all', count(*),
        'mine', count(*) filter (where b.assigned_to = p_team_member_id),
        'unassigned', count(*) filter (where b.assigned_to is null),
        'unread', count(*) filter (where b.unread_for_me)
      ) from base b
    ) end,
    'expiring', case when p_with_expiring then coalesce((select jsonb_agg(to_jsonb(e)) from expiring e), '[]'::jsonb) end
  );
$function$;

revoke all on function public.inbox_page(text, uuid, text, boolean, boolean, text, uuid, text, text, text[], timestamptz, timestamptz, integer, integer, boolean, boolean) from public, anon;
grant execute on function public.inbox_page(text, uuid, text, boolean, boolean, text, uuid, text, text, text[], timestamptz, timestamptz, integer, integer, boolean, boolean) to authenticated;
