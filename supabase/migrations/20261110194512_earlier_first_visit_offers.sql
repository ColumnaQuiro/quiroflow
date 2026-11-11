-- Offering an earlier time to someone whose FIRST visit is days away.
--
-- People who come from the first-visit offer often find nothing free that
-- week and book the next one. When a time frees up before theirs, nobody
-- tells them: the slot goes unused and the new patient waits a week longer,
-- which is when they are most likely not to come at all. This lets the
-- clinic write to them on WhatsApp ("se ha liberado un hueco... ¿quieres
-- adelantarla?") and move the visit when they tap "Sí".
--
-- Its own table rather than more waitlist_entries: a waitlist entry is
-- someone WITHOUT a visit, and claiming one creates an appointment. This is
-- someone WITH one, and accepting moves it. Fifteen screens and jobs read
-- waitlist_entries (the waitlist page, the class panel, the cancel step, the
-- patient app's "Avísame", the expiry sweep) and every one of them would
-- have had to learn to leave these rows alone.
--
-- One row per appointment, ever. A visit whose patient said "no, me quedo
-- con la mía", or that already moved earlier once, is not asked again.
--
-- What decides who is asked lives here, in triggers, so every way a visit is
-- booked or moved -- the calendar, online booking, the receptionist, the
-- public API, the app -- enrols it the same way. What decides WHEN and with
-- WHAT time is server/utils/earlierVisitOffers.ts, run by the waitlist sweep
-- (api/waitlist/expire-cron, every 15 minutes).

-- Per clinic, and off. Nothing in Settings shows it: it is switched on by
-- hand for the clinics trying it. accounts_settings_permission does not list
-- it, so accounts_guard_settings lets only an owner (or the service role)
-- change it -- never a receptionist through the REST API.
alter table public.accounts
  add column earlier_first_visit_offers boolean not null default false;

comment on column public.accounts.earlier_first_visit_offers is
  'Offer an earlier freed time by WhatsApp to patients whose first visit is 2+ days away (earlier_visit_offers). Off by default; no Settings control.';

create table public.earlier_visit_offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  -- waiting   enrolled, nothing offered right now
  -- offered   a time was sent and is open until offer_expires_at
  -- accepted  the visit was moved to an offered time
  -- declined  they said they would rather keep theirs (the button, the
  --           receptionist, or the front desk taking them off)
  -- closed    the visit stopped qualifying: cancelled, had, moved near, or
  --           changed to another type
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'accepted', 'declined', 'closed')),
  -- Capped (EARLIER_VISIT_MAX_OFFERS) and at most one a day, so nobody is
  -- messaged every time something frees up.
  offers_made integer not null default 0,
  last_offered_at timestamptz,
  -- The time on offer while status = 'offered'.
  offered_starts_at timestamptz,
  offered_ends_at timestamptz,
  offer_expires_at timestamptz,
  -- Why it stopped, in words, for the waitlist page.
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index earlier_visit_offers_appointment_id_idx on public.earlier_visit_offers (appointment_id);
create index earlier_visit_offers_account_status_idx on public.earlier_visit_offers (account_id, status);

alter table public.earlier_visit_offers enable row level security;
select public.require_two_factor_on('public.earlier_visit_offers');
select public.grant_data_api('public.earlier_visit_offers');

-- Staff see them on the waitlist page and may take someone off (declined).
-- Rows are written by the triggers below and by the server with the service
-- role; nobody inserts or deletes one by hand.
create policy "staff read earlier_visit_offers" on public.earlier_visit_offers
  for select using (public.is_account_member(account_id));
create policy "staff update earlier_visit_offers" on public.earlier_visit_offers
  for update using (public.is_account_member(account_id)) with check (public.is_account_member(account_id));

-- Whether a visit is one to offer earlier times for: a booked first visit
-- (appointment_types.stage first_visit or first_visit_offer), not a class
-- place, at least two days ahead, at a clinic that switched this on.
-- The two days are EARLIER_VISIT_ENROL_DAYS in utils/earlierVisitOffer.ts.
create or replace function public.earlier_visit_qualifies(p_appt public.appointments)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_appt.status = 'booked'
    and p_appt.deleted_at is null
    and p_appt.class_session_id is null
    and p_appt.practitioner_id is not null
    and p_appt.starts_at >= now() + interval '2 days'
    and exists (
      select 1 from public.appointment_types t
      where t.id = p_appt.appointment_type_id and t.stage in ('first_visit', 'first_visit_offer')
    )
    and exists (
      select 1 from public.accounts a
      where a.id = p_appt.account_id and a.earlier_first_visit_offers
    )
$$;

-- Keeps a visit's row in step with the visit, whoever changed it.
--
-- Security definer: a visit booked through online booking or the patient
-- app runs as a role that cannot write this table, and must still enrol.
create or replace function public.sync_earlier_visit_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.earlier_visit_offers;
begin
  select * into v_row from public.earlier_visit_offers where appointment_id = new.id;

  if v_row.id is null then
    if public.earlier_visit_qualifies(new) then
      insert into public.earlier_visit_offers (account_id, appointment_id)
      values (new.account_id, new.id)
      on conflict (appointment_id) do nothing;
    end if;
    return new;
  end if;

  if v_row.status not in ('waiting', 'offered') then
    return new;
  end if;

  -- Moved to exactly the time on offer -- by the receptionist, after they
  -- answered in their own words, or by the front desk -- is the offer taken.
  if v_row.status = 'offered' and new.status = 'booked' and new.deleted_at is null and new.starts_at = v_row.offered_starts_at then
    update public.earlier_visit_offers
      set status = 'accepted', offer_expires_at = null, updated_at = now()
      where id = v_row.id;
    return new;
  end if;

  if public.earlier_visit_qualifies(new) then
    -- Still a first visit far enough away. A time offered for the visit as
    -- it was is withdrawn: what it said no longer describes their visit.
    if new.starts_at is distinct from old.starts_at or new.practitioner_id is distinct from old.practitioner_id then
      update public.earlier_visit_offers
        set status = 'waiting', offered_starts_at = null, offered_ends_at = null, offer_expires_at = null, updated_at = now()
        where id = v_row.id;
    end if;
  else
    update public.earlier_visit_offers
      set status = 'closed',
          offered_starts_at = null, offered_ends_at = null, offer_expires_at = null,
          closed_reason = case
            when new.deleted_at is not null then 'deleted'
            when new.status = 'cancelled' then 'cancelled'
            when new.status <> 'booked' then new.status
            when new.starts_at < now() + interval '2 days' then 'moved_near'
            else 'no_longer_a_first_visit'
          end,
          updated_at = now()
      where id = v_row.id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_earlier_visit_offer
  after insert or update of starts_at, status, deleted_at, appointment_type_id, practitioner_id on public.appointments
  for each row execute function public.sync_earlier_visit_offer();

-- Switching it on enrols the first visits already booked, so the clinic does
-- not have to wait for new bookings to see it work.
create or replace function public.enrol_earlier_visit_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.earlier_first_visit_offers and not coalesce(old.earlier_first_visit_offers, false) then
    insert into public.earlier_visit_offers (account_id, appointment_id)
    select a.account_id, a.id
    from public.appointments a
    where a.account_id = new.id
      and a.status = 'booked'
      and a.starts_at >= now() + interval '2 days'
      and public.earlier_visit_qualifies(a)
    on conflict (appointment_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_enrol_earlier_visit_offers
  after update of earlier_first_visit_offers on public.accounts
  for each row execute function public.enrol_earlier_visit_offers();
