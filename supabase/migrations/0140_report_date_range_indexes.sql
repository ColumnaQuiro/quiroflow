-- 0138 indexed every unindexed foreign key, which covers the "everything for
-- this one patient/account" queries. It doesn't cover the other shape the
-- reports and dashboard widgets lean on constantly: filtering a whole table
-- down to a date window (income, income-performance, custom reports,
-- statistics, and the Income/Statistics/VisitSummary dashboard widgets all
-- range-filter on paid_at / created_at).
--
-- Both of those were confirmed sequential scans against live data --
-- payments read 3257 rows to return 165, invoices read 3278 to return 186 --
-- and they get linearly worse as a clinic accumulates history.
create index if not exists payments_paid_at_idx on public.payments (paid_at);
create index if not exists invoices_created_at_idx on public.invoices (created_at);

-- Most appointment queries pair a status filter with a starts_at window
-- ("completed visits this month"). The existing (clinic_id, starts_at) index
-- gets used for the date range even when no clinic is given, but every row in
-- the window is then re-checked against status; leading with status skips
-- those rows in the index itself.
create index if not exists appointments_status_starts_at_idx on public.appointments (status, starts_at);
