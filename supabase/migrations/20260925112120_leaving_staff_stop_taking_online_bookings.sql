-- Someone who has left is never offered for online booking, whichever way
-- they left.
--
-- Settings -> Team -> Deactivate switches online_booking_enabled off itself,
-- but closing your OWN login (/api/account/delete) only sets deleted_at. The
-- web booking page, the patient app and the receptionist all filter on
-- online_booking_enabled -- the web page does not also check deleted_at -- so
-- a practitioner who closed their account stayed bookable online, and
-- patients could book someone who would never turn up.
--
-- Fixed where the state is set rather than in each reader: leaving turns
-- online booking off, in the same row write. Reactivating does not turn it
-- back on; that stays a decision for whoever reactivates them.
--
-- Named to sort after guard_team_member_write, so the guard sees the write
-- as its author made it (BEFORE triggers run in name order).

create or replace function public.team_member_leaving_stops_online_booking()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.online_booking_enabled := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists team_member_leaving_stops_online_booking on public.team_members;
create trigger team_member_leaving_stops_online_booking
  before update of deleted_at on public.team_members
  for each row execute function public.team_member_leaving_stops_online_booking();

-- The people who already left that way.
update public.team_members
set online_booking_enabled = false
where deleted_at is not null and online_booking_enabled;
