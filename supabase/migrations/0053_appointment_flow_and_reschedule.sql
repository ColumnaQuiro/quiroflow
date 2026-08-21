-- Calendar "Flow Tracker": front-desk patients move through Arrived (already
-- tracked via checked_in_at) -> With Practitioner -> Awaiting Checkout as
-- they progress through a visit, mirroring PracticeHub's Calendar Settings
-- panel. Two new stage timestamps alongside the existing checked_in_at.
alter table appointments add column flow_with_practitioner_at timestamptz;
alter table appointments add column flow_checkout_at timestamptz;

-- Lightweight marker (not full reschedule history) set when an appointment's
-- date/time is edited in place, so the Calendar's "Rescheduled" status
-- filter has something real to filter on.
alter table appointments add column rescheduled boolean not null default false;
