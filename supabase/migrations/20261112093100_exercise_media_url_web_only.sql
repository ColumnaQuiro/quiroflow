-- An exercise's video link is a web address, and nothing else.
--
-- The Exercises library only lets staff type an https:// link, but that is
-- the form: any member can insert an exercise through PostgREST ("staff add
-- exercises"), and the patient's "Ver el vídeo" opened exercises.media_url in
-- a same-origin tab. A javascript: link there ran on app.quiroflow.com with
-- the patient's session -- their records at every clinic, their family's, and
-- their password. utils/openWhenReady.ts now refuses anything but http(s);
-- this keeps such a link from being stored in the first place.
--
-- Leading whitespace is not allowed either: browsers strip it, so
-- ' javascript:' is still javascript:.
alter table public.exercises
  add constraint exercises_media_url_is_web
  check (media_url is null or media_url ~* '^https?://');
