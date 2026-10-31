-- The Inbox opens on "Needs reply": conversations where the patient wrote
-- last, or that are unread for the person looking. awaiting_us alone is only
-- the first half, and a thread someone marked unread on purpose -- because
-- the clinic wrote last but it still wants doing -- dropped out of the very
-- view meant to hold what is left to do.
--
-- inbox_page as in 20261018091939_inbox_page_in_one_request.sql, with one
-- more p_reply value. awaiting_us and awaiting_patient are unchanged, so the
-- code already deployed keeps working against this.

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
           or (p_reply = 'needs_reply' and (b.last_direction = 'inbound' or b.unread_for_me))
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
