-- What a voice note said, written down.
--
-- The AI receptionist cannot hear audio: a voice note reached it as
-- "[Voice note -- you cannot listen to it]", so a patient who asked for an
-- appointment out loud got a reply asking them to write it instead, or none.
-- Voice notes are now transcribed (Mistral's Voxtral, EU-hosted) the first
-- time the receptionist reads the conversation, and the text is kept here so
-- each one is transcribed once rather than on every reply after it.
--
-- Null means "not transcribed": not yet, not audio, no transcription key on
-- this deployment, or the attempt failed (the next draft tries again).
alter table public.whatsapp_messages add column if not exists transcript text;

comment on column public.whatsapp_messages.transcript is
  'Automatic transcript of an inbound voice note (media_type = audio), filled the first time the AI receptionist reads it. Null when not transcribed.';
