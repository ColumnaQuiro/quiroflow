-- The AI receptionist keeping a visit instead of losing it.
--
-- Measured at one clinic, 12 Oct - 19 Nov 2026: a follow-up visit cancelled
-- through the receptionist came back 9 times in 23, "Cambiar cita" on a
-- reminder ended cancelled with nothing booked 26 times in 77, and somebody
-- who said "ya te aviso" booked 9 times in 47 -- because after its "escríbenos
-- cuando quieras" nothing ever wrote to them again. Times offered late in the
-- evening went unanswered and stayed that way.
--
-- Three things here, for the code that changes that (utils/receptionistConversion.ts):
--
--   1. receptionist_follow_ups: a message the receptionist owes somebody --
--      one nudge the morning after times were offered and not answered
--      ('nudge'), or the day it agreed to write on ('agreed'). Sent by the
--      15-minute handover job; where WhatsApp no longer lets it write, an
--      agreed one becomes a task for a person.
--   2. receptionist_slot_holds: a time just offered, kept out of what other
--      conversations are offered for a few minutes. A patient chose a time
--      and was told it had just gone, twice in one conversation (8 Nov 2026).
--      It holds nothing against the desk or online booking -- only against
--      the receptionist offering the same minute to two people.
--   3. receptionist_report() also says what became of cancellations with no
--      other visit ahead, of times offered, and of "Cambiar cita" taps.
--
-- Like receptionist_reply_traces, both tables are about the conversation, not
-- the person: the Inbox's conversation key (a patient's id, or lead:<id>) as
-- text, dates and a kind -- never a name, a number or any text. So nothing
-- here needs moving by merge_patients or removing by anonymize_patient: a
-- follow-up whose patient is gone finds nobody and is dropped, and a hold is
-- gone in twenty minutes.

create table public.receptionist_follow_ups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- A patient's id, or lead:<id>.
  conversation_key text not null,
  -- Where they last wrote, which is where the follow-up goes.
  channel text not null check (channel in ('whatsapp', 'app', 'webchat', 'messenger')),
  kind text not null check (kind in ('nudge', 'agreed')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  -- 'sent', 'task' (a person was asked to write), 'dropped' (no longer
  -- needed, or not possible), 'failed' (the channel refused it).
  outcome text check (outcome in ('sent', 'task', 'dropped', 'failed'))
);

-- One waiting of each kind per conversation: a second offer the same evening
-- moves the nudge, it does not add one.
create unique index receptionist_follow_ups_one_open on public.receptionist_follow_ups (account_id, conversation_key, kind) where done_at is null;
create index receptionist_follow_ups_due on public.receptionist_follow_ups (due_at) where done_at is null;
create index receptionist_follow_ups_account_created on public.receptionist_follow_ups (account_id, created_at desc);

alter table public.receptionist_follow_ups enable row level security;
-- Read by whoever configures the receptionist; written only by the service role.
create policy "receptionist config staff read receptionist_follow_ups" on public.receptionist_follow_ups
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.receptionist_follow_ups');
select public.grant_data_api('public.receptionist_follow_ups');

create table public.receptionist_slot_holds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index receptionist_slot_holds_live on public.receptionist_slot_holds (account_id, expires_at);

alter table public.receptionist_slot_holds enable row level security;
create policy "receptionist config staff read receptionist_slot_holds" on public.receptionist_slot_holds
  for select
  using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
select public.require_two_factor_on('public.receptionist_slot_holds');
select public.grant_data_api('public.receptionist_slot_holds');

-- The report, as 20261115172804 wrote it, plus: of the cancellations, those
-- with no other visit ahead ('alone') and how many of them had a new visit
-- made within a fortnight ('rebooked'); what became of the times it offered
-- ('timeOffers') and of "Cambiar cita" taps ('changeTaps'), each looked at
-- once three days have passed; and the follow-ups it sent ('followUps').

create or replace function public.receptionist_report(p_account_id uuid, p_since timestamptz, p_time_zone text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with notes as (
    select date_trunc('week', n.created_at at time zone p_time_zone)::date as wk, lower(btrim(n.body)) as b
    from inbox_notes n
    where n.account_id = p_account_id and n.author_id is null and n.created_at >= p_since
  ),
  replies as (
    select date_trunc('week', r.created_at at time zone p_time_zone)::date as wk, r.delivery, r.conversation_key
    from receptionist_replies r
    where r.account_id = p_account_id and r.created_at >= p_since
  ),
  weeks as (
    select wk from notes union select wk from replies
  ),
  weekly as (
    select w.wk,
           (select count(*) from replies r where r.wk = w.wk and r.delivery = 'sent') as sent,
           (select count(*) from replies r where r.wk = w.wk and r.delivery = 'draft') as drafted,
           (select count(distinct r.conversation_key) from replies r where r.wk = w.wk) as conversations,
           (select count(*) from notes n where n.wk = w.wk and n.b like 'he reservado%') as booked,
           (select count(*) from notes n where n.wk = w.wk and n.b like 'he movido%') as moved,
           (select count(*) from notes n where n.wk = w.wk and n.b like 'he cancelado%') as cancelled,
           (select count(*) from notes n where n.wk = w.wk and n.b like 'he pasado esta conversación%') as handed_over
    from weeks w
  ),
  changes as (
    select case when l.actor in ('receptionist', 'staff') then l.actor else 'other' end as who,
           l.created_at,
           (l.changes -> 'status' ->> 'to') = 'cancelled' as is_cancel,
           l.changes ? 'starts_at' as is_move,
           (l.changes -> 'starts_at' ->> 'to')::timestamptz < (l.changes -> 'starts_at' ->> 'from')::timestamptz as earlier,
           a.id as appointment_id, a.patient_id, a.cancellation_reason,
           coalesce(t.stage in ('first_visit', 'first_visit_offer'), false) as first_visit
    from audit_logs l
    join appointments a on a.id = l.entity_id
    left join appointment_types t on t.id = a.appointment_type_id
    where l.account_id = p_account_id
      and l.entity_type = 'appointment'
      and l.action = 'updated'
      and l.created_at >= p_since
      and ((l.changes -> 'status' ->> 'to') = 'cancelled' or l.changes ? 'starts_at')
  ),
  cancels as (
    select c.*,
           exists (
             select 1 from appointments b
             where b.patient_id = c.patient_id and b.id <> c.appointment_id and b.deleted_at is null
               and b.status in ('booked', 'completed') and b.starts_at > c.created_at
           ) as came_back,
           -- No other visit ahead when it was cancelled: the ones a new time
           -- is really needed for.
           not exists (
             select 1 from appointments b
             where b.patient_id = c.patient_id and b.id <> c.appointment_id and b.deleted_at is null
               and b.status <> 'cancelled' and b.created_at < c.created_at and b.starts_at > c.created_at
           ) as alone,
           -- A new visit made within a fortnight of it.
           exists (
             select 1 from appointments b
             where b.patient_id = c.patient_id and b.id <> c.appointment_id and b.deleted_at is null
               and b.created_at > c.created_at - interval '30 minutes' and b.created_at < c.created_at + interval '14 days'
           ) as rebooked
    from changes c
    where c.is_cancel
  ),
  -- Times the receptionist offered, once per conversation and day, and what
  -- the diary shows in the three days after.
  time_offers as (
    select distinct on (coalesce(m.patient_id, m.lead_id), (m.created_at at time zone p_time_zone)::date)
           m.created_at, coalesce(m.patient_id, ld.patient_id) as patient_id
    from whatsapp_messages m
    left join leads ld on ld.id = m.lead_id
    where m.account_id = p_account_id and m.sent_by_ai and m.direction = 'outbound' and m.created_at >= p_since
      and m.body_preview ~ '\d{1,2}[:.]\d{2}' and m.body_preview like '%?%'
      and m.body_preview !~* '(pudiste mirar las horas|te escribo como quedamos)'
    order by coalesce(m.patient_id, m.lead_id), (m.created_at at time zone p_time_zone)::date, m.created_at
  ),
  time_offer_results as (
    select o.created_at,
           exists (select 1 from audit_logs l where l.account_id = p_account_id and l.entity_type = 'appointment' and l.patient_id = o.patient_id
                     and l.actor = 'receptionist' and (l.action = 'created' or l.changes ? 'starts_at')
                     and l.created_at > o.created_at and l.created_at < o.created_at + interval '72 hours') as by_receptionist,
           exists (select 1 from audit_logs l where l.account_id = p_account_id and l.entity_type = 'appointment' and l.patient_id = o.patient_id
                     and l.actor is distinct from 'receptionist' and (l.action = 'created' or l.changes ? 'starts_at')
                     and l.created_at > o.created_at and l.created_at < o.created_at + interval '72 hours') as by_team
    from time_offers o
  ),
  -- "Cambiar cita" tapped on a reminder, once per person and day.
  change_taps as (
    select distinct on (coalesce(m.patient_id, m.lead_id), (m.created_at at time zone p_time_zone)::date)
           m.created_at, coalesce(m.patient_id, ld.patient_id) as patient_id
    from whatsapp_messages m
    left join leads ld on ld.id = m.lead_id
    where m.account_id = p_account_id and m.direction = 'inbound' and m.created_at >= p_since
      and m.body_preview ~* '^\s*cambiar cita\s*$'
    order by coalesce(m.patient_id, m.lead_id), (m.created_at at time zone p_time_zone)::date, m.created_at
  ),
  change_tap_results as (
    select t.created_at,
           exists (select 1 from audit_logs l where l.account_id = p_account_id and l.entity_type = 'appointment' and l.patient_id = t.patient_id
                     and (l.action = 'created' or l.changes ? 'starts_at')
                     and l.created_at > t.created_at and l.created_at < t.created_at + interval '72 hours') as moved,
           exists (select 1 from audit_logs l where l.account_id = p_account_id and l.entity_type = 'appointment' and l.patient_id = t.patient_id
                     and (l.changes -> 'status' ->> 'to') = 'cancelled'
                     and l.created_at > t.created_at and l.created_at < t.created_at + interval '72 hours') as cancelled
    from change_taps t
  ),
  follow_ups as (
    select f.kind, f.outcome
    from receptionist_follow_ups f
    where f.account_id = p_account_id and f.created_at >= p_since and f.done_at is not null
  ),
  offers as (
    select o.*, a.status as visit_status
    from earlier_visit_offers o
    join appointments a on a.id = o.appointment_id
    where o.account_id = p_account_id and o.created_at >= p_since
  )
  select jsonb_build_object(
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', wk, 'sent', sent, 'drafted', drafted, 'conversations', conversations,
        'booked', booked, 'moved', moved, 'cancelled', cancelled, 'handedOver', handed_over
      ) order by wk) from weekly), '[]'::jsonb),
    'cancellations', coalesce((select jsonb_object_agg(who, x) from (
        select who, jsonb_build_object(
          'total', count(*),
          'cameBack', count(*) filter (where came_back),
          'firstVisits', count(*) filter (where first_visit),
          'firstVisitsCameBack', count(*) filter (where first_visit and came_back),
          'alone', count(*) filter (where alone),
          'rebooked', count(*) filter (where alone and rebooked)
        ) as x
        from cancels group by who
      ) s), '{}'::jsonb),
    'moves', coalesce((select jsonb_object_agg(who, x) from (
        select who, jsonb_build_object('total', count(*), 'earlier', count(*) filter (where earlier)) as x
        from changes where is_move group by who
      ) s), '{}'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object(
        'reason', reason, 'total', total, 'firstVisits', first_visits, 'cameBack', came_back
      ) order by total desc) from (
        select cancellation_reason as reason, count(*) as total,
               count(*) filter (where first_visit) as first_visits,
               count(*) filter (where came_back) as came_back
        from cancels group by cancellation_reason
      ) s), '[]'::jsonb),
    'timeOffers', (select jsonb_build_object(
        'total', count(*),
        'bookedByReceptionist', count(*) filter (where by_receptionist),
        'bookedByTeam', count(*) filter (where by_team and not by_receptionist),
        'nothing', count(*) filter (where not by_team and not by_receptionist)
      ) from time_offer_results where created_at < now() - interval '72 hours'),
    'changeTaps', (select jsonb_build_object(
        'total', count(*),
        'moved', count(*) filter (where moved),
        'cancelledOnly', count(*) filter (where cancelled and not moved),
        'nothing', count(*) filter (where not cancelled and not moved)
      ) from change_tap_results where created_at < now() - interval '72 hours'),
    'followUps', (select jsonb_build_object(
        'nudgesSent', count(*) filter (where kind = 'nudge' and outcome = 'sent'),
        'agreedSent', count(*) filter (where kind = 'agreed' and outcome = 'sent'),
        'agreedTasks', count(*) filter (where kind = 'agreed' and outcome = 'task'),
        'dropped', count(*) filter (where outcome = 'dropped')
      ) from follow_ups),
    'earlierOffers', (select jsonb_build_object(
        'enrolled', count(*),
        'offered', count(*) filter (where offers_made > 0),
        'messages', coalesce(sum(offers_made), 0),
        'accepted', count(*) filter (where status = 'accepted'),
        'acceptedAttended', count(*) filter (where status = 'accepted' and visit_status = 'completed'),
        'acceptedCancelled', count(*) filter (where status = 'accepted' and visit_status = 'cancelled'),
        'declined', count(*) filter (where status = 'declined'),
        'closedCancelled', count(*) filter (where status = 'closed' and closed_reason = 'cancelled'),
        'open', count(*) filter (where status in ('waiting', 'offered')),
        'daysEarlierAccepted', round(avg(extract(epoch from (last_offered_visit_at - last_offered_starts_at)) / 86400.0) filter (where status = 'accepted' and last_offered_starts_at is not null), 1)
      ) from offers)
  );
$function$;

revoke all on function public.receptionist_report(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.receptionist_report(uuid, timestamptz, text) to service_role;
