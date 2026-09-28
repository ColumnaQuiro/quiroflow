-- An online booking that arrived from an ad becomes a lead.
--
-- The Growth dashboard -- funnel, channel table, cost per booking -- is built
-- entirely from `leads` (server/api/growth/dashboard.get.ts). Leads came from
-- Meta lead forms, WhatsApp and Instagram, and from nowhere else. Somebody who
-- clicked a Google ad and booked straight from the widget never filled in a
-- form, so they became a patient with an appointment and never a lead: Google
-- Ads reported the conversion, and QuiroFlow showed no Google channel at all.
-- The campaign WAS captured -- booking_attribution has held the gclid since
-- the website started forwarding it -- but nothing read that table.
--
-- So when a booking carries a campaign, and the patient is not on the board
-- already, this puts them there: at Booked, with a source the dashboard's
-- channelOf() groups on ("Google Ads", "Meta Ads", or the utm_source as given)
-- and the campaign after a '·', the shape the Meta ingest already writes.
-- From there leads_follow_appointments moves it to Showed and Converted like
-- any other lead.
--
-- What does NOT make a lead:
--   * A referrer on its own. The widget is iframed on the clinic's own site,
--     so nearly every booking has one; it says where the widget was, not
--     what brought the visitor.
--   * A patient already linked to a lead. The booking trigger has just linked
--     and moved a Meta form lead or a WhatsApp enquiry by email or phone; a
--     second card would count one person twice in the funnel.
--
-- No sequence is started and no marketing consent is recorded. lead.created
-- automations are fired explicitly by the ingest routes, never by an insert,
-- and somebody who has just booked should not get a "book your first visit"
-- drip.
--
-- Bookings made before this existed are not swept up here; that is a one-off
-- run of the function over booking_attribution, done by hand.
create or replace function public.lead_for_attributed_booking(p_appointment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt record;
  v_attr record;
  v_platform text;
  v_source text;
  v_name text;
  v_email text;
  v_phone text;
  v_year integer := extract(year from now() at time zone 'utc');
  v_count integer;
  v_lead_id uuid;
begin
  select a.id, a.account_id, a.clinic_id, a.patient_id, a.created_at, a.status, a.checked_in_at, a.deleted_at
  into v_appt
  from appointments a where a.id = p_appointment_id;
  if v_appt.id is null or v_appt.deleted_at is not null then
    return null;
  end if;

  select * into v_attr from booking_attribution where appointment_id = p_appointment_id;
  if v_attr.appointment_id is null then
    return null;
  end if;

  -- A click id names the platform outright. A utm_source is taken at its
  -- word, except that the spellings of Google and Meta arriving on a paid
  -- medium (or none) join the same channel the click ids and the Meta form
  -- ingest use -- the clinic's own Facebook ads link with utm_source=Facebook
  -- and utm_medium=ad. The same source on an organic medium stays its own
  -- channel: a link in an Instagram bio is not an ad.
  v_platform := case v_attr.click_id_source
    when 'google' then 'Google Ads'
    when 'meta' then 'Meta Ads'
    when 'tiktok' then 'TikTok Ads'
    when 'microsoft' then 'Microsoft Ads'
  end;
  if v_platform is null and v_attr.utm_source is not null then
    v_platform := case
      when coalesce(lower(v_attr.utm_medium), 'cpc') in ('cpc', 'ppc', 'paid', 'ad', 'ads', 'paid_social', 'paidsocial', 'paid-social', 'cpm', 'display')
           and lower(v_attr.utm_source) in ('google', 'adwords', 'googleads', 'google_ads')
        then 'Google Ads'
      when coalesce(lower(v_attr.utm_medium), 'cpc') in ('cpc', 'ppc', 'paid', 'ad', 'ads', 'paid_social', 'paidsocial', 'paid-social', 'cpm', 'display')
           and lower(v_attr.utm_source) in ('facebook', 'fb', 'instagram', 'ig', 'meta')
        then 'Meta Ads'
      -- channelOf() splits on '·', so one inside a source would cut it short.
      -- An all-lowercase source is capitalised so utm_source=instagram joins
      -- the "Instagram" channel the DM leads already make, rather than
      -- sitting beside it as a second row; one with its own casing is kept.
      else replace(
        case when v_attr.utm_source = lower(v_attr.utm_source) then initcap(v_attr.utm_source) else v_attr.utm_source end,
        '·', '-')
    end;
  end if;
  if v_platform is null then
    return null;
  end if;
  v_source := v_platform || coalesce(' · ' || nullif(trim(v_attr.utm_campaign), ''), '');

  if exists (
    select 1 from leads l
    where l.account_id = v_appt.account_id and l.patient_id = v_appt.patient_id and l.deleted_at is null
  ) then
    return null;
  end if;

  select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), nullif(lower(trim(p.email)), '')
  into v_name, v_email
  from patients p where p.id = v_appt.patient_id;

  -- Digits only, country code first: the shape the Meta ingest and WhatsApp
  -- write, which is what the lead drawer shows and matches on.
  select nullif(regexp_replace(coalesce(n.country_code, '') || n.number, '\D', '', 'g'), '')
  into v_phone
  from patient_contact_numbers n
  where n.patient_id = v_appt.patient_id
  order by n.is_whatsapp desc, n.created_at
  limit 1;

  -- The same "LEAD-2026-0918" as nextLeadReference() in server/utils/leads.ts,
  -- numbered from the highest reference this year rather than by counting
  -- created_at: this lead is dated back to its booking, so a count by date
  -- can come out lower than a number already taken. While every lead is
  -- numbered by count the two agree.
  select coalesce(max(substring(reference from '^LEAD-\d{4}-(\d+)$')::integer), 0) into v_count
  from leads where account_id = v_appt.account_id and reference like 'LEAD-' || v_year || '-%';

  begin
    insert into leads (
      account_id, clinic_id, reference, full_name, email, phone, channel, source, stage,
      patient_id, external_source, external_id, created_at
    ) values (
      v_appt.account_id,
      v_appt.clinic_id,
      'LEAD-' || v_year || '-' || lpad((v_count + 1)::text, 4, '0'),
      coalesce(v_name, 'Online booking'),
      v_email,
      v_phone,
      'web',
      v_source,
      -- Only a late run over older bookings can meet one already attended.
      case when v_appt.checked_in_at is not null or v_appt.status = 'completed' then 'showed' else 'booked' end,
      v_appt.patient_id,
      -- One lead per booking, enforced by leads_account_external_idx: a retry
      -- of the attribution call cannot make a second.
      'booking',
      v_appt.id::text,
      -- The booking's own time, so the lead lands in the month it was made,
      -- and leads_follow_appointments (which ignores visits from before a
      -- lead came in) counts this appointment when it is attended.
      v_appt.created_at
    )
    returning id into v_lead_id;
  exception when unique_violation then
    select id into v_lead_id from leads
    where account_id = v_appt.account_id and external_source = 'booking' and external_id = v_appt.id::text;
    return v_lead_id;
  end;

  insert into lead_events (account_id, lead_id, kind, title, detail, occurred_at)
  values (v_appt.account_id, v_lead_id, 'appointment', 'Booked online', 'From ' || v_source, v_appt.created_at);

  return v_lead_id;
end;
$$;

-- Server-only: it reads any account's bookings by id. Called with the service
-- role from server/api/public-booking/attribution.post.ts.
revoke all on function public.lead_for_attributed_booking(uuid) from public, anon, authenticated;
