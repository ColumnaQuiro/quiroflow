-- Appointment types for children only.
--
-- A clinic can price a child's first visit differently ("Primera visita niño",
-- 50 EUR at Columnaquiro). The type says so here, and the AI receptionist then
-- offers it only for a minor (under 18) -- booked through the parent writing,
-- who becomes the child's tutor -- and never to an adult. See
-- typesForMinor / typesForAudience in utils/receptionistTypes.ts.
--
-- Same table, same audit trigger, same update policy as the type's other
-- settings; nothing new to guard.
alter table appointment_types add column for_minors boolean not null default false;

comment on column appointment_types.for_minors is
  'Only for patients under 18. The AI receptionist offers it for a minor booked through their tutor, never to an adult.';
