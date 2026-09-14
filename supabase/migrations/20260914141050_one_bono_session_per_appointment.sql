-- One visit, one session off the bono.
--
-- Reception reported being able to press the bono button repeatedly before
-- processing the patient, and Adrian Oropeza's Bono 12 proves it: two
-- package_sessions rows, both against appointment 6bdc090b, 18 seconds apart,
-- 88 EUR of a 528 EUR bono consumed for a single visit.
--
-- usePackageSession() already guards the case it was written for -- a SHARED
-- family bono drawn on from two patients' screens at once -- by re-reading
-- the bono and doing a compare-and-set on sessions_used. That is the wrong
-- shape for this. The second click is not concurrent: it reads
-- sessions_used = 1, claims 1 -> 2, and succeeds, because taking a second
-- session is a perfectly legal thing to do -- just not for the same visit.
-- Nothing anywhere asked whether THIS appointment had already taken one.
--
-- So the rule goes where it cannot be clicked past. The UI check that comes
-- with this reports it kindly; this is what makes it true, including for the
-- mobile app and anything added later.
--
-- Partial, because appointment_id is nullable: a session logged from the
-- patient's own Billing tab has no appointment to belong to, and any number
-- of those may exist.
create unique index package_sessions_one_per_appointment
  on package_sessions (appointment_id)
  where appointment_id is not null;

comment on index package_sessions_one_per_appointment is
  'A visit draws at most one session from a bono. Added after a double click took two sessions for one appointment; the UI check in AppointmentBillingTab.usePackageSession is the friendly half of the same rule.';
