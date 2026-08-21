-- Two free-text fields feeding the Calendar hover card: a short per-appointment
-- reception note (e.g. "Confirmar"), and a persistent per-patient clinical
-- note that accumulates across visits (unlike appointment notes, which are
-- tied to a single visit).
alter table appointments add column note text;
alter table patients add column sticky_note text;
