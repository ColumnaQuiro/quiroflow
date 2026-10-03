-- Only one process walks an automation run at a time.
--
-- A run is advanced from several places: inline, the moment it starts (a
-- lead's welcome drip, a patient rule fired by an event), by the 15-minute
-- tick, by an event that wakes a wait_until, and by a person's Retry or Skip.
-- Nothing stopped two of them taking the same run at once. A drip's run is
-- inserted due immediately (resume_at defaults to now()) and then advanced in
-- the same request -- so a tick landing in that window read it as due and
-- walked it too, and the first message went out twice.
--
-- claimed_until is a lease. advanceRun takes it with one conditional update
-- (status 'running', due, and nobody else's lease still live) that returns the
-- row as it is now, walks THAT row rather than whatever the caller read
-- earlier, and clears it at the end. A process that dies mid-walk leaves a
-- lease that simply runs out, so nothing is stuck for longer than that.
--
-- Additive and nullable: the code already deployed neither reads nor writes
-- it, and every existing run starts unclaimed.
alter table public.automation_sequence_runs add column if not exists claimed_until timestamptz;

comment on column public.automation_sequence_runs.claimed_until is
  'Lease held by the process currently advancing this run (automationEngine advanceRun). Null or past = free.';
