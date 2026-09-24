-- The Inbox, rebuilt: read status per person, conversations with an owner,
-- the conversation list built here rather than in the browser, and a way to
-- attach an unknown number to a patient.
--
-- 1. inbox_reads. whatsapp_conversation_reads (0083) is one row per
--    conversation for the whole account, so when anyone opened a thread it
--    stopped being unread for everybody -- while archive and labels were
--    already per person. Read status is per person now too, like both of
--    them. Seeded from the shared table for every current team member, so
--    nobody opens the new inbox to find everything unread. The old table
--    stays: the live code reads it until the next release, and nothing here
--    writes it any more.
--
-- 2. inbox_assignments. Who is looking after a conversation, shared by the
--    whole team (unlike 1). One row per conversation; no row means
--    unassigned. A patient writing again does not change it.
--
-- 3. inbox_conversations. The page used to download the latest 1,000
--    WhatsApp and 1,000 in-app messages and group them in the browser, every
--    15 seconds and on every incoming message: anything older fell off the
--    list and out of search, silently. One row per conversation here, keyed
--    exactly as the page always keyed them (patient, else phone, else
--    Instagram id) so every existing archive, label and read row still
--    matches. Lead-only messages stay out, as they always have -- the Growth
--    lead list draws those. Per-person columns (my_*) come from
--    current_team_member_id(), so the same view answers for whoever asks.
--
-- 4. link_inbox_conversation(). A number that wrote in before it was on any
--    patient is its own conversation, keyed by the number; linking moves its
--    messages onto the patient and carries the keyed rows (reads, archive,
--    labels, assignment) across, so it becomes the one patient thread.

-- ---------------------------------------------------------------- 1. reads
create table public.inbox_reads (
  account_id uuid not null references accounts(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  conversation_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (team_member_id, conversation_key)
);
create index inbox_reads_account_idx on public.inbox_reads (account_id, team_member_id);
alter table public.inbox_reads enable row level security;
create policy "staff manage own inbox_reads" on public.inbox_reads
  for all using (
    is_account_member(account_id)
    and has_permission(account_id, 'inbox_access')
    and team_member_id = current_team_member_id(account_id)
  )
  with check (
    is_account_member(account_id)
    and has_permission(account_id, 'inbox_access')
    and team_member_id = current_team_member_id(account_id)
  );
select public.require_two_factor_on('public.inbox_reads');

insert into public.inbox_reads (account_id, team_member_id, conversation_key, last_read_at)
select r.account_id, tm.id, r.conversation_key, r.last_read_at
from whatsapp_conversation_reads r
join team_members tm on tm.account_id = r.account_id and tm.deleted_at is null
on conflict do nothing;

-- ---------------------------------------------------------------- 2. assignments
create table public.inbox_assignments (
  account_id uuid not null references accounts(id) on delete cascade,
  conversation_key text not null,
  team_member_id uuid not null references team_members(id) on delete cascade,
  assigned_by uuid references team_members(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (account_id, conversation_key)
);
create index inbox_assignments_member_idx on public.inbox_assignments (team_member_id);
alter table public.inbox_assignments enable row level security;
create policy "staff manage inbox_assignments" on public.inbox_assignments
  for all using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));
select public.require_two_factor_on('public.inbox_assignments');

-- ---------------------------------------------------------------- 3. the list
create index if not exists patient_app_messages_account_created_idx on public.patient_app_messages (account_id, created_at desc);

create view public.inbox_conversations
  with (security_invoker = true)
  as
  with msgs as (
    select m.account_id,
           coalesce(m.patient_id::text, m.phone_number, m.external_contact_id, 'unknown') as conversation_key,
           m.patient_id, m.phone_number, m.external_contact_id, m.channel, m.direction, m.status,
           m.body_preview, m.template_name, m.media_type, m.created_at
    from whatsapp_messages m
    where m.lead_id is null or m.patient_id is not null
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

-- ---------------------------------------------------------------- 4. linking
-- Security invoker: every write below is one the caller's own RLS already
-- allows (updating messages, their own reads/archive/labels, the shared
-- assignment), so this only makes them happen together.
create or replace function public.link_inbox_conversation(p_phone_number text, p_patient_id uuid)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_moved integer;
  v_me uuid;
begin
  select account_id into v_account from patients where id = p_patient_id;
  if v_account is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  if not (is_account_member(v_account) and has_permission(v_account, 'inbox_access')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_me := current_team_member_id(v_account);

  update whatsapp_messages
     set patient_id = p_patient_id
   where account_id = v_account and phone_number = p_phone_number and patient_id is null;
  get diagnostics v_moved = row_count;

  -- The newer read wins; archive and labels carry over as they were.
  insert into inbox_reads (account_id, team_member_id, conversation_key, last_read_at)
  select account_id, team_member_id, p_patient_id::text, last_read_at
  from inbox_reads where team_member_id = v_me and conversation_key = p_phone_number
  on conflict (team_member_id, conversation_key) do update set last_read_at = greatest(inbox_reads.last_read_at, excluded.last_read_at);
  delete from inbox_reads where team_member_id = v_me and conversation_key = p_phone_number;

  insert into whatsapp_conversation_archives (account_id, team_member_id, conversation_key)
  select account_id, team_member_id, p_patient_id::text
  from whatsapp_conversation_archives where team_member_id = v_me and conversation_key = p_phone_number
  on conflict do nothing;
  delete from whatsapp_conversation_archives where team_member_id = v_me and conversation_key = p_phone_number;

  insert into whatsapp_conversation_labels (account_id, team_member_id, conversation_key, label_id)
  select account_id, team_member_id, p_patient_id::text, label_id
  from whatsapp_conversation_labels where team_member_id = v_me and conversation_key = p_phone_number
  on conflict do nothing;
  delete from whatsapp_conversation_labels where team_member_id = v_me and conversation_key = p_phone_number;

  -- An assignment already on the patient's own thread stays; otherwise the
  -- number's comes with it.
  insert into inbox_assignments (account_id, conversation_key, team_member_id, assigned_by, assigned_at)
  select account_id, p_patient_id::text, team_member_id, assigned_by, assigned_at
  from inbox_assignments where account_id = v_account and conversation_key = p_phone_number
  on conflict do nothing;
  delete from inbox_assignments where account_id = v_account and conversation_key = p_phone_number;

  return v_moved;
end;
$function$;

revoke all on function public.link_inbox_conversation(text, uuid) from public, anon;
grant execute on function public.link_inbox_conversation(text, uuid) to authenticated;
