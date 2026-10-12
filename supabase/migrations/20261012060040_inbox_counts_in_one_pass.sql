-- The Inbox's four tab counts (All, Mine, Unassigned, Unread) in one pass.
--
-- The web Inbox asked for them as four exact counts over inbox_conversations,
-- and each one rebuilt every conversation from every message: the view has no
-- shortcut for a count, so "how many are mine" costs exactly what listing them
-- all does (~400 ms on the largest account today). Four of them ran on every
-- open and again after every message that arrived. One pass with FILTERs gives
-- the same four numbers for the price of one.
--
-- Security invoker, over the same view with the same filters the list uses
-- (pages/inbox.vue, inboxQuery), so RLS and two-factor apply exactly as they
-- do to the list beside it, and a count always describes that list.

create or replace function public.inbox_counts(p_view text, p_team_member_id uuid)
returns table (all_count integer, mine integer, unassigned integer, unread integer)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select count(*)::integer,
         count(*) filter (where assigned_to = p_team_member_id)::integer,
         count(*) filter (where assigned_to is null)::integer,
         count(*) filter (where unread_for_me)::integer
    from inbox_conversations
   where my_archived = (p_view = 'archived')
     and case p_view
           when 'snoozed' then my_snoozed_until is not null
           when 'active' then my_snoozed_until is null
           else true
         end;
$function$;

revoke all on function public.inbox_counts(text, uuid) from public, anon;
grant execute on function public.inbox_counts(text, uuid) to authenticated;
