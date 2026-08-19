-- Controls how finely the Calendar's time grid is divided per clinic (e.g.
-- 15 minutes shows 9:00, 9:15, 9:30... rows), matching the equivalent
-- setting in PracticeHub's own Location > Calendar Settings.

alter table clinics add column slot_duration_minutes integer not null default 30;
