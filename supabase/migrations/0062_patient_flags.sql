-- Chief complaint + red/yellow flags for the My Day patient view. Tags reuse
-- the existing patients.tags column rather than adding a new one.
alter table patients add column chief_complaint text;
alter table patients add column red_flags text;
alter table patients add column yellow_flags text;
