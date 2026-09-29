-- The Growth lead list in the Inbox, without a 1000-message window.
--
-- (The Inbox's four tab counts were also going to become one function here.
-- Measured against the busiest local clinic, one combined count took 129-159
-- ms against 11-58 ms for each of the four separate queries: each filter
-- pushes down into inbox_conversations, while a combined count has to build
-- every conversation. Sent in parallel, the four finish sooner, so they stay.)
--
-- inbox_lead_previews(p_account_id): one row per lead with a message, its
--    latest message, and the lead fields the Inbox row shows.
--
--    /api/growth/conversations fetched the newest 1000 lead messages and
--    grouped them in JavaScript to find each lead's last one. A lead whose
--    last message was older than the 1000th simply was not in the Inbox, and
--    one busy thread was enough to push quieter ones out. It then asked for
--    those leads by id in the URL -- `id=in.(...)` -- which has its own
--    ~8 KB limit, around two hundred ids; lifting the message window would
--    have walked straight into that. So the leads are joined here instead,
--    under the same filters the endpoint applied: the lead is in the account
--    and not deleted, and ai_taken_over_by resolves to a name the way the
--    embed did (a left join, null when nobody or not visible).
--
--    has_draft replaces returning ai_draft_body: the list only shows THAT a
--    draft is waiting, and says so in its own comment.
--
--    SECURITY INVOKER: the endpoint uses the caller's own client, so
--    whatsapp_messages, leads and team_members apply their RLS (and
--    two-factor) exactly as the three queries did. p_account_id is the
--    endpoint's .eq('account_id', ...), kept because RLS alone would return
--    every account the caller belongs to.

create or replace function public.inbox_lead_previews(p_account_id uuid)
returns table (
  lead_id uuid,
  channel text,
  direction text,
  body_preview text,
  status text,
  created_at timestamptz,
  full_name text,
  phone text,
  source text,
  stage text,
  ai_state text,
  estimated_value_cents integer,
  patient_id uuid,
  has_draft boolean,
  taken_over_by_name text
)
language sql
stable
set search_path = public
as $$
  with last_message as (
    select distinct on (m.lead_id) m.lead_id, m.channel, m.direction, m.body_preview, m.status, m.created_at
    from whatsapp_messages m
    where m.account_id = p_account_id
      and m.lead_id is not null
    order by m.lead_id, m.created_at desc
  )
  select lm.lead_id, lm.channel, lm.direction, lm.body_preview, lm.status, lm.created_at,
         l.full_name, l.phone, l.source, l.stage, l.ai_state, l.estimated_value_cents, l.patient_id,
         coalesce(l.ai_draft_body, '') <> '',
         t.full_name
  from last_message lm
  join leads l on l.id = lm.lead_id
  left join team_members t on t.id = l.ai_taken_over_by
  where l.account_id = p_account_id
    and l.deleted_at is null
  order by lm.created_at desc, lm.lead_id
$$;

revoke all on function public.inbox_lead_previews(uuid) from anon, public;
grant execute on function public.inbox_lead_previews(uuid) to authenticated, service_role;
