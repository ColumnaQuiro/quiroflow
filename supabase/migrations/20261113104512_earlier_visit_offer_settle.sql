-- When a first visit last changed day or time, so an earlier time is not
-- offered to someone who has only just booked or moved it.
--
-- On 12 Nov 2026 the offer went to a patient an hour after she had put that
-- day's first visit off to the next week (she accepted a slot that same
-- afternoon, and the desk had to move it back), to another twenty minutes
-- after the desk moved his, and to a third five minutes after booking, for a
-- day and time he had just said he could not do. Someone who has just chosen
-- a day has told us what suits them; the sweep now waits a day
-- (EARLIER_VISIT_SETTLE_HOURS in utils/earlierVisitOffer.ts) after this.
--
-- created_at is not enough: an enrolled visit that is moved keeps its row,
-- and updated_at also moves each time an offer lapses.

alter table public.earlier_visit_offers add column visit_changed_at timestamptz;
update public.earlier_visit_offers set visit_changed_at = created_at;
alter table public.earlier_visit_offers
  alter column visit_changed_at set default now(),
  alter column visit_changed_at set not null;

comment on column public.earlier_visit_offers.visit_changed_at is
  'When the visit was booked or last moved to another day, time or practitioner. No offer goes out within a day of it.';

-- As in 20261110194512_earlier_first_visit_offers.sql, with visit_changed_at
-- stamped when an enrolled visit moves.
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

  -- Moved to the time on offer: that is the offer accepted, whoever moved it.
  if v_row.status = 'offered' and new.status = 'booked' and new.deleted_at is null and new.starts_at = v_row.offered_starts_at then
    update public.earlier_visit_offers
      set status = 'accepted', offer_expires_at = null, updated_at = now()
      where id = v_row.id;
    return new;
  end if;

  if public.earlier_visit_qualifies(new) then
    if new.starts_at is distinct from old.starts_at or new.practitioner_id is distinct from old.practitioner_id then
      update public.earlier_visit_offers
        set status = 'waiting', offered_starts_at = null, offered_ends_at = null, offer_expires_at = null,
            visit_changed_at = now(), updated_at = now()
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
