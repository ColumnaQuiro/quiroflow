-- Unused holidays carried into the next year, as a clinic setting (the
-- Personal spec's open questions, 9 Nov 2026). 0 is the default and means
-- what it always has: the allowance is per year and nothing carries over.
--
-- N means up to N days left unused in a year are added to the next year's
-- allowance. They come from that year's own allowance and do not chain: days
-- carried into 2027 and left unused there do not move on to 2028. Worked out
-- where the allowance is read (leaveCarryIn in utils/teamLeave.ts), so there
-- is no yearly job to forget to run.
--
-- Set in Turnos, which is owners only; the column is not listed in
-- accounts_settings_permission, so accounts_guard_settings already requires
-- an owner to change it.
alter table public.accounts
  add column leave_carry_over_days numeric(4, 1) not null default 0
  check (leave_carry_over_days >= 0 and leave_carry_over_days <= 60);
