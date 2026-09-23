-- A bono PracticeHub has closed is not a bono the patient can still use.
--
-- The packages importer brings closed bonos in on purpose, as history: a bono
-- is deactivated in PracticeHub once it is spent, so skipping them left a
-- patient's Billing tab showing a course of visits with nothing that paid for
-- them (see the comment at PracticeHubPatientPackagesImporter.vue, "Closed
-- packages are imported too"). They arrive with owed_cents zeroed so they move
-- nobody's debt.
--
-- What they do not arrive with is any mark saying they are closed, because
-- package_purchases has nowhere to put one. So a closed bono that still has
-- visits left on its counter is indistinguishable from a live one, and
-- everything that asks "what can this patient draw on?" answers by comparing
-- sessions_used against sessions_total -- usePatientFinancialSummary's
-- activePackages, the Billing tab's bono card, the calendar's "use a session".
--
-- Paqui Cortes is the case that surfaced it: PH-package-531, a 480 EUR Bono
-- mantenimiento bought on 12 Aug with one session taken, deactivated in
-- PracticeHub and re-issued on 9 Sep as PH-package-551 at the same price with
-- the same eleven visits left. PracticeHub shows her one live bono. QuiroFlow
-- showed two, and counted 440 EUR of the closed one's sessions as money she
-- could draw on -- money PracticeHub does not think exists.
--
-- Across the live account that is 12 bonos: closed in PracticeHub, unused
-- sessions here.
--
-- A boolean and not a closed_at, which would match the deleted_at convention
-- used elsewhere: PracticeHub's packages carry an `active` flag and no closing
-- date, so any timestamp here would be the moment we noticed rather than the
-- moment it closed, and a later reader would have no way to tell the two
-- apart.
alter table package_purchases
  add column if not exists is_closed boolean not null default false;

comment on column package_purchases.is_closed is
  'PracticeHub has deactivated this package (active = 0). The row stays as history -- its visits and its ledger entries are real -- but it offers no sessions and its remaining value is not counted as money the patient can draw on.';

-- Backfill from the snapshot of PracticeHub's own packages taken at the
-- cutover. ph_packages_snapshot is not created by any migration (it was loaded
-- by the importer), so a fresh database -- every Cypress run -- does not have
-- it. Guarded the same way 0173 guards its RLS loop over the same table.
do $$
begin
  if to_regclass('public.ph_packages_snapshot') is not null then
    update package_purchases pp
    set is_closed = true
    from ph_packages_snapshot s
    where pp.external_reference = 'PH-package-' || s.ph_id
      and s.active = 0
      and pp.is_closed = false;
  end if;
end $$;
