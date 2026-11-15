-- Why a visit was cancelled, and a first visit put off "for later" in Recalls.
--
-- Measured on 15 Nov 2026 at the one clinic with the AI receptionist: of the
-- first visits it cancelled since 12 Oct, 14, one person had booked again.
-- At the desk it was 2 of 13. Nearly every one ended "escríbenos cuando
-- quieras otra fecha" -- and nobody ever wrote, because nothing asked anyone
-- to. A first visit cancelled is a new patient lost, unless somebody picks
-- the conversation up again.
--
-- Two columns:
--
-- appointments.cancellation_reason -- what they gave as the reason, one of a
--   short fixed list so it can be counted (the receptionist offers the same
--   list as WhatsApp choices: utils/cancellationReason.ts). Null when nobody
--   said, which is every cancellation before this.
--
-- patients.first_visit_deferred_at -- when someone who has never come said
--   they would book their first visit later. That puts them in Recalls,
--   which until now only held people who had attended at least once (every
--   row was keyed on the last attended visit): someone who never came had no
--   date to be overdue from, so they never appeared at all. They are counted
--   from this date instead, so they show once the queue's "weeks overdue"
--   filter is reached, like everybody else. Once they attend, their real
--   last visit takes over; booking anything ahead takes them off the list,
--   as it does for anyone.
--
-- The recall automations are untouched: their audiences filter on the last
-- attended visit (utils/automationAudience.ts), which these people do not
-- have, so nobody is sent "hace tiempo que no vienes" for a visit they never
-- had.

alter table public.appointments
  add column cancellation_reason text
    check (cancellation_reason in ('another_time', 'later', 'feeling_better', 'unforeseen', 'price', 'other'));

comment on column public.appointments.cancellation_reason is
  'Why it was cancelled, when they said: another_time, later, feeling_better, unforeseen, price, other (utils/cancellationReason.ts). Null when nobody said.';

alter table public.patients
  add column first_visit_deferred_at timestamptz;

comment on column public.patients.first_visit_deferred_at is
  'When they cancelled their first visit saying they would book later. Puts someone who never attended in Recalls, counted from this date.';

-- What the receptionist report needs from an earlier-time offer once it is
-- answered: the time that was offered, and when their visit was at the time.
-- offered_starts_at is cleared as soon as an offer closes, so a "no" kept no
-- record of what it said no to.
alter table public.earlier_visit_offers
  add column last_offered_starts_at timestamptz,
  add column last_offered_visit_at timestamptz;

comment on column public.earlier_visit_offers.last_offered_starts_at is
  'The time last offered, kept after the offer closes (offered_starts_at is cleared).';
comment on column public.earlier_visit_offers.last_offered_visit_at is
  'When their visit was at the moment of the last offer: with last_offered_starts_at, how much earlier it would have been.';

-- ---------------------------------------------------------------------------
-- recall_candidates, as in 20261022185125 but for someone who put off their
-- first visit: kept even with no attended visit, counted from when they said
-- so, and with first_visit_deferred_at at the end for the page to say why
-- they are there. last_appointment_at stays the last ATTENDED visit (null for
-- them), so nothing reading it shows a visit that never happened.
create or replace view public.recall_candidates
  with (security_invoker = true)
as
select f.patient_id,
       p.account_id,
       p.first_name,
       p.last_name,
       p.email,
       p.tags,
       lb.balance_cents,
       p.recall_priority,
       p.default_practitioner_id,
       f.last_appointment_at,
       current_date - coalesce(f.last_appointment_at, p.first_visit_deferred_at)::date as days_since_last_appointment,
       p.preferred_language,
       p.clinic_id,
       f.last_no_show_at,
       (
         select tm.id from team_members tm
         where tm.deleted_at is null
           and tm.id = case
             when ra.id is not null then ra.team_member_id
             when acc.recall_assignee_default = 'practitioner' then p.default_practitioner_id
             when acc.recall_assignee_default = 'member' then acc.recall_assignee_member_id
           end
       ) as assigned_to,
       case when f.last_appointment_at is null then p.first_visit_deferred_at end as first_visit_deferred_at
from patient_visit_facts() f
cross join lateral (select p1.* from patients p1 where p1.id = f.patient_id offset 0) p
left join patient_live_balances lb on lb.patient_id = p.id
left join recall_assignments ra on ra.patient_id = p.id and ra.assigned_at > coalesce(f.last_appointment_at, p.first_visit_deferred_at)
left join accounts acc on acc.id = p.account_id
where (f.last_appointment_at is not null or p.first_visit_deferred_at is not null)
  and not f.has_future_appointment
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor
  and (p.recall_snoozed_until is null or p.recall_snoozed_until <= current_date)
  and (
    p.recall_status = 'active'
    or (p.recall_status = 'dismissed' and p.recall_dismissed_at is not null and f.last_appointment_at > p.recall_dismissed_at)
  );

-- recall_parked, as in 20261003155100 but with the same people: snoozing or
-- dismissing someone who put off their first visit parks them like anyone,
-- rather than making them vanish from all three tabs.
create or replace view public.recall_parked
  with (security_invoker = true)
as
select f.patient_id,
       p.account_id,
       p.clinic_id,
       p.first_name,
       p.last_name,
       p.default_practitioner_id,
       f.last_appointment_at,
       current_date - coalesce(f.last_appointment_at, p.first_visit_deferred_at)::date as days_since_last_appointment,
       p.recall_snoozed_until,
       p.recall_dismissed_at,
       case when p.recall_status = 'dismissed' then 'dismissed' else 'snoozed' end as parked_as
from patient_visit_facts() f
cross join lateral (select p1.* from patients p1 where p1.id = f.patient_id offset 0) p
where (f.last_appointment_at is not null or p.first_visit_deferred_at is not null)
  and not f.has_future_appointment
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor
  and (
    (p.recall_status = 'dismissed' and (p.recall_dismissed_at is null or f.last_appointment_at is null or f.last_appointment_at <= p.recall_dismissed_at))
    or (p.recall_status = 'active' and p.recall_snoozed_until > current_date)
  );

-- Offers already answered: their visit's time then is the visit's time now
-- for every one that was not taken (a "no" leaves the visit where it was).
-- The time offered was never kept, so it stays null for them.
update public.earlier_visit_offers o
   set last_offered_visit_at = a.starts_at
  from public.appointments a
 where a.id = o.appointment_id
   and o.offers_made > 0
   and o.status <> 'accepted';

-- ---------------------------------------------------------------------------
-- The AI receptionist's report (Growth > AI receptionist > Report): week by
-- week what it did, how much of the clinic's cancelling and moving it now
-- does, whether the people who cancelled came back, why they cancelled, and
-- what offering earlier first visits has done. One call, because each part
-- reads tables a member cannot all read (inbox_notes needs inbox access,
-- audit_logs is the owner's) and the route has already checked the caller
-- may see the receptionist: service role only, never callable from the API.
--
-- Everything is read from records that already exist -- the receptionist's
-- own notes in the thread (receptionistActivity.ts reads the same), its
-- reply allowance rows, the audit trail's appointment changes -- so the
-- report cannot claim what the thread does not show.
--
-- "Came back" is whether the patient has a visit after the cancellation,
-- booked or had: a first visit cancelled is a new patient lost unless one
-- exists.
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
           ) as came_back
    from changes c
    where c.is_cancel
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
          'firstVisitsCameBack', count(*) filter (where first_visit and came_back)
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
