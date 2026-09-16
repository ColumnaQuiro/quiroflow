-- The receptionist starts answering real enquiries -- as a draft.
--
-- Until now the model only ran in "Try Alba", the owner talking to their own
-- configuration. Nothing it produced could reach a patient, which made it a
-- demo of a product rather than the product. This is the first step where it
-- reads a real conversation and writes a real reply.
--
-- Deliberately a draft, not a send. The clinic's voice is the clinic's, and
-- the first time a model speaks for it should be a sentence somebody read
-- first. That also matches what this product already does one screen over:
-- reviews.draft_body holds an AI reply to a public review and a person
-- approves it, for the same reason and with the same shape.
--
-- Answering directly, without a person in the loop, stays a separate decision
-- and a separate change. When it comes, it needs a kill switch, rate limits
-- and a rule for what happens when the model is wrong -- none of which this
-- needs, because a human reads every word.

alter table leads
  add column ai_draft_body text,
  add column ai_draft_created_at timestamptz;

comment on column leads.ai_draft_body is
  'A reply the receptionist drafted, awaiting a person. Never what was sent -- sent messages are rows in whatsapp_messages. Cleared on approve or discard.';

comment on column leads.ai_draft_created_at is
  'When the draft was written, so the Inbox can say how stale it is -- a reply drafted before the patient said three more things is worth re-reading.';
