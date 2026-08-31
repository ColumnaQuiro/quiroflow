-- Public read: blocked time ranges for a clinic, so the booking widget can
-- treat blocked time the same as an existing appointment when computing
-- free slots. availability_blocks has no practitioner column (only an
-- optional room_id) -- a block always shows on every room's column on the
-- staff calendar when room_id is null, and only on one room's column
-- otherwise, but the booking widget never lets a patient pick a room, so
-- any block for the clinic (whole-clinic or room-specific) is treated as
-- unavailable for every practitioner rather than risk double-booking a
-- room that turns out to be the one actually assigned.
create or replace function get_booking_blocked_times(
  p_clinic_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.starts_at, b.ends_at
  from availability_blocks b
  join clinics c on c.id = b.clinic_id and c.online_booking_enabled = true
  where b.clinic_id = p_clinic_id
    and b.starts_at < p_to
    and b.ends_at > p_from;
$$;

revoke all on function get_booking_blocked_times(uuid, timestamptz, timestamptz) from public;
grant execute on function get_booking_blocked_times(uuid, timestamptz, timestamptz) to anon, authenticated;
