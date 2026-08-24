-- Enables pg_cron so the birthday automation trigger can run on a
-- schedule (see server/api/automations/birthday-cron.post.ts) --
-- everything else in this app is event-driven from the client, but "is it
-- this patient's birthday today" has no client action to hang off of.
-- The actual cron.schedule(...) call isn't in this migration: it needs
-- this deployment's real URL and NUXT_CRON_SECRET, which only exist for
-- the production project, not local dev -- it's applied separately there.
create extension if not exists pg_cron;
