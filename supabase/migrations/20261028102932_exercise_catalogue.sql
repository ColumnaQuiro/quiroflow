-- QuiroFlow's starter catalogue of home exercises (utils/exerciseCatalog.ts),
-- each with an animated demonstration served from the web app
-- (public/exercise-catalog/<slug>.mp4).
--
-- The catalogue itself is code, not rows: nothing is in a clinic's library
-- until someone adds it there, and adding copies it into `exercises` like an
-- exercise typed by hand, so the clinic edits or archives its own copy and
-- the patient-side policies see an ordinary row.
--
--   exercises.starter_key   which catalogue exercise the row was copied
--                           from; it keeps the demonstration video attached
--                           and stops the same one being added twice. Null
--                           for anything the clinic wrote itself. The same
--                           idea, and name, as learn_articles.starter_key.
--
-- The index is per account and counts archived rows too: adding one again
-- restores the archived copy rather than making a second.
alter table public.exercises add column starter_key text;

create unique index exercises_one_starter
  on public.exercises (account_id, starter_key)
  where starter_key is not null;
