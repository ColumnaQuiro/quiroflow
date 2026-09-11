-- A patient entering their clinic code needs to see *which* clinic it
-- belongs to before signing in -- a mistyped code that happens to match
-- another practice would otherwise fail much later, at claim time, with
-- nothing to explain why.
--
-- The mobile app validates its code through record_app_open() (which
-- raises on an unknown slug), but that also writes a device row into the
-- app-usage analytics -- wrong for a browser, and it tells the patient
-- nothing anyway. The web portal needs a read-only lookup instead.
--
-- Deliberately narrow: name only, by exact slug, and it raises rather
-- than returning null so an unknown code can't be distinguished from a
-- clinic with no name. Slugs are already public (they're the booking URL,
-- see get_public_booking_info), so this exposes nothing new -- it just
-- avoids dragging the whole booking payload in for two fields.
create or replace function get_clinic_by_code(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  select id, name into v_id, v_name from accounts where slug = lower(trim(p_slug));
  if v_id is null then
    raise exception 'Unknown clinic';
  end if;
  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$$;

revoke all on function get_clinic_by_code(text) from public;
grant execute on function get_clinic_by_code(text) to anon, authenticated;
