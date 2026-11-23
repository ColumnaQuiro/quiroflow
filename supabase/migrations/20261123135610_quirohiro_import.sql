-- QuiroHiro imports run on the server like PracticeHub's and Quirocitas'
-- (server/utils/importJobs.ts).
--
-- QuiroHiro is a white-labelled GoHighLevel: a job reads its v2 API with a
-- Private Integration token the clinic creates (Settings > Integraciones
-- Privado), saved in account_secrets as quirohiro_token beside
-- quirohiro_location_id, into import_snapshots; the steps then plan and write
-- from that copy in slices. No new table: only the source each of the two
-- tables accepts.

alter table public.import_jobs drop constraint import_jobs_source_check;
alter table public.import_jobs add constraint import_jobs_source_check
  check (source in ('quirocitas', 'practicehub', 'quirohiro'));

alter table public.import_snapshots drop constraint import_snapshots_source_check;
alter table public.import_snapshots add constraint import_snapshots_source_check
  check (source in ('quirocitas', 'practicehub', 'quirohiro'));
