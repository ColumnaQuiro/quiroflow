-- Official public holidays close the clinic by themselves
-- (utils/spanishHolidays.ts, server/utils/publicHolidays.ts).
--
-- A clinic says which comunidad autónoma it is in; with holidays_auto on,
-- every national and regional holiday the app knows is added as a
-- whole-clinic closure -- the same availability block "Cierres y festivos"
-- already adds by hand, which the calendar, online booking, the public API
-- and the leave count all read as closed. Nothing new to teach them.
--
-- holidays_loaded_through is how far that has gone. The daily cron adds what
-- lies past it once a deploy brings a new year, and a holiday the owner
-- removed stays removed: the marker has already passed it.

alter table public.clinics
  add column if not exists holiday_region text
    check (holiday_region in ('ES-AN','ES-AR','ES-AS','ES-IB','ES-CN','ES-CB','ES-CM','ES-CL','ES-CT','ES-EX','ES-GA','ES-MD','ES-MC','ES-NC','ES-PV','ES-RI','ES-VC','ES-CE','ES-ML')),
  add column if not exists holidays_auto boolean not null default false,
  add column if not exists holidays_loaded_through date;

-- The holiday a closure was added for, so the same day is never closed twice
-- and the list can say "Festivo oficial" rather than guess from the note.
alter table public.availability_blocks
  add column if not exists public_holiday date;

create unique index if not exists availability_blocks_one_per_public_holiday
  on public.availability_blocks (clinic_id, public_holiday)
  where public_holiday is not null;
