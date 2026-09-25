-- What receptionist_config.bookable_appointment_type_ids means, now that
-- something reads it.
--
-- 20260914104340 said "Empty means none". Nothing read the column and nothing
-- could write it, so what every clinic actually had was a receptionist that
-- offered times for any type -- and every row holds the default, '{}'.
-- Enforcing "none" on that would have stopped every live receptionist
-- offering appointments without anyone choosing it. So empty is "any active
-- type", a non-empty list restricts, and an archived type is never offered
-- either way. utils/receptionistTypes.ts is where that is applied.
--
-- Documentation only: no data or behaviour changes here.

comment on column public.receptionist_config.bookable_appointment_type_ids is
  'Appointment types the AI receptionist may offer. Empty = any active (non-archived) type; non-empty = only these. Archived types are never offered. Applied in utils/receptionistTypes.ts.';
