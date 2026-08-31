-- availability_blocks had no practitioner scope at all (only an optional
-- room) -- every block was either "this room" or "the whole clinic",
-- affecting every practitioner regardless. null keeps that existing
-- behavior; set it to scope a block to just one practitioner (e.g.
-- blocking Jordana's calendar without touching anyone else's).
alter table availability_blocks add column practitioner_id uuid references team_members(id) on delete cascade;

-- Public read: blocked time ranges for a clinic, now including which
-- practitioner (if any) the block applies to, so the booking widget can
-- scope it the same way the staff calendar does instead of treating every
-- block as clinic-wide. Adding a column changes the OUT-parameter row type,
-- which create-or-replace refuses -- drop and recreate instead.
drop function get_booking_blocked_times(uuid, timestamptz, timestamptz);

create function get_booking_blocked_times(
  p_clinic_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, practitioner_id uuid)
language sql
security definer
set search_path = public
as $$
  select b.starts_at, b.ends_at, b.practitioner_id
  from availability_blocks b
  join clinics c on c.id = b.clinic_id and c.online_booking_enabled = true
  where b.clinic_id = p_clinic_id
    and b.starts_at < p_to
    and b.ends_at > p_from;
$$;

revoke all on function get_booking_blocked_times(uuid, timestamptz, timestamptz) from public;
grant execute on function get_booking_blocked_times(uuid, timestamptz, timestamptz) to anon, authenticated;
