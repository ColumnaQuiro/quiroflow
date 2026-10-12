-- What actually happened to each lead, for the Growth dashboard's funnel.
--
-- The funnel used to read leads.furthest_stage alone, and two things made
-- that wrong in production:
--
--   * Nothing moves a lead to Contacted when the clinic writes to it. The
--     follow-up sequence and Inbox replies send WhatsApp messages, the lead
--     stays in New, and the funnel reported 12 of 87 leads contacted when 74
--     had been messaged -- with a red "75 leads did not reach Contacted"
--     banner under it.
--
--   * A lead can be Converted without a visit -- by hand, and until
--     20261012144928 by "Convert to patient" -- and the funnel counts
--     cumulatively, so it counted as Booked AND Showed before any
--     appointment had happened.
--
-- The stages themselves are left alone: moving a lead on the board changes
-- what automations see, and the board is the clinic's to arrange. This only
-- reports the evidence, one row per lead; utils/leadReach.ts decides what a
-- stage means from it, for the dashboard and the Reports funnel alike.
--
-- Security invoker, so the caller's own RLS (including the two-factor
-- restrictive policies) decides what it can see; it creates no table.
--
-- The appointment window matches leads_follow_appointments(): appointments
-- on or after the day the lead came in. A five-year patient who fills in an
-- ad form has not been "booked" by a visit in 2023.

create or replace function public.growth_lead_progress(p_account_id uuid, p_since timestamptz, p_until timestamptz default null)
returns table (lead_id uuid, contacted boolean, booked boolean, attended boolean, appointment_due boolean)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select l.id,
         -- Sent and not failed. 'would_send' is a dry run and reached nobody.
         exists (
           select 1 from whatsapp_messages w
            where w.lead_id = l.id
              and w.direction = 'outbound'
              and w.status in ('sent', 'delivered', 'read')
         ) or exists (
           select 1 from email_messages e
            where e.lead_id = l.id
              and not e.dry_run
              and e.failed_at is null
              and e.bounced_at is null
         ),
         -- Any appointment counts as booked, a cancelled one included: it was
         -- booked, and the show rate is where not turning up is counted.
         exists (
           select 1 from appointments a
            where a.patient_id = l.patient_id
              and a.deleted_at is null
              and a.starts_at >= date_trunc('day', l.created_at)
         ),
         exists (
           select 1 from appointments a
            where a.patient_id = l.patient_id
              and a.deleted_at is null
              and a.starts_at >= date_trunc('day', l.created_at)
              and a.status not in ('cancelled', 'no_show')
              and (a.checked_in_at is not null or a.status = 'completed')
         ),
         -- Whether there has been a chance to turn up yet. A lead booked for
         -- next week has not failed to show, and must not count against the
         -- show rate until the day passes.
         exists (
           select 1 from appointments a
            where a.patient_id = l.patient_id
              and a.deleted_at is null
              and a.starts_at >= date_trunc('day', l.created_at)
              and a.starts_at < now()
         )
    from leads l
   where l.account_id = p_account_id
     and l.deleted_at is null
     and l.created_at >= p_since
     and (p_until is null or l.created_at <= p_until);
$function$;

revoke all on function public.growth_lead_progress(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.growth_lead_progress(uuid, timestamptz, timestamptz) to authenticated;

-- email_messages had no lead index; the whatsapp one exists
-- (whatsapp_messages_lead_idx).
create index if not exists email_messages_lead_idx on email_messages (lead_id) where lead_id is not null;
