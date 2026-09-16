-- The receptionist drafts without being asked.
--
-- Drafting works, and the switch that gates it now gates something, but
-- somebody still has to open a thread and press a button -- which means the
-- receptionist only ever helps people who already went looking. A lead that
-- writes at 21:40 has a draft waiting when it is asked for, which is not the
-- same as having one waiting.
--
-- What makes an unprompted version need a column: it runs on a tick, so
-- "should this lead have a draft" has to be answerable without re-asking the
-- model. ai_draft_body alone cannot answer it. Discarding a draft clears that
-- column, so the next tick would look at the same unanswered message, decide
-- a draft is missing, and write another -- and the clinic would be unable to
-- get rid of one. Approving clears it too, with the same result.
--
-- So: remember how far the drafting has READ, separately from whether a draft
-- is currently sitting there. Set when a draft is written, never cleared by
-- approving or discarding. A lead is due a draft only when they have said
-- something newer than this.
--
-- The effect is what a person would do: answer once, and not again until
-- they write again.

alter table leads add column ai_drafted_through_at timestamptz;

comment on column leads.ai_drafted_through_at is
  'Timestamp of the newest inbound message the receptionist has drafted against. Deliberately NOT cleared on approve or discard -- it is how far drafting has read, not whether a draft exists, and clearing it would redraft a discarded reply on the next tick.';

-- The tick asks one question: which leads have said something since we last
-- drafted. Without this it is a full scan of leads per account every 15
-- minutes, for a question whose answer is almost always "none".
create index leads_awaiting_draft_idx
  on leads (account_id, ai_state)
  where deleted_at is null and ai_state = 'handling';
