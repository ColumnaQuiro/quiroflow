-- PracticeHub imports run on the server too (server/utils/importJobs.ts), the
-- way Quirocitas has since 20261117093012_server_side_imports.sql.
--
-- The browser importer needed someone with data_admin on the clinic to sit
-- through a dozen steps with the tab open. A re-sync of a clinic still keying
-- its work into PracticeHub -- the whole of onboarding, for every clinic so
-- far -- meant asking the clinic to do it again, or nobody doing it. Now a job
-- reads PracticeHub's Classic API into import_snapshots and the same steps
-- plan and write from that copy in slices.
--
-- `dryRun` in import_jobs.options (no schema change) plans every step and
-- writes nothing: each step's result then says what it WOULD have written.

alter table public.import_jobs drop constraint import_jobs_source_check;
alter table public.import_jobs add constraint import_jobs_source_check
  check (source in ('quirocitas', 'practicehub'));

alter table public.import_snapshots drop constraint import_snapshots_source_check;
alter table public.import_snapshots add constraint import_snapshots_source_check
  check (source in ('quirocitas', 'practicehub'));
