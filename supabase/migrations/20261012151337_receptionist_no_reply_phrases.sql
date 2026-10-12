-- Messages the AI receptionist leaves alone: no reply, no draft. A patient
-- tapping "Confirmar" on the appointment reminder has said all there is to
-- say -- the reminder flow already records the confirmation -- and on its
-- first day answering, 15 of 22 waiting conversations were exactly that, each
-- with a draft re-confirming the visit. "Gracias", "Ok" and a thumbs-up are
-- the same.
--
-- Matched against the whole message, ignoring case, accents and punctuation
-- (utils/receptionistAutoReply.ts, isNoReplyMessage), so "¡Gracias!" is
-- "gracias" but "Gracias, ¿y el jueves?" is a question. Edited on Growth >
-- Receptionist; the model may also decide on its own that nothing needs
-- saying (NO_REPLY).
alter table public.receptionist_config
  add column no_reply_phrases text[] not null
  default array['Confirmar', 'Confirmo', 'Confirmado', 'Gracias', 'Muchas gracias', 'Ok', 'Vale', '👍'];
