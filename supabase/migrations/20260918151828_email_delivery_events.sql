-- What happened to an email after it was handed to Resend.
--
-- Nothing recorded it. runEmailAction posted to Resend and threw the response
-- away, so the only thing the app could say about a campaign was how many
-- patients matched -- not how many emails actually arrived, and certainly not
-- how many were opened, clicked or bounced. A campaign whose every message
-- hard-bounced looked identical to one that landed.
--
-- One row per email rather than a log of raw events. The questions being asked
-- are "how many were opened" and "how many bounced", which are counts of
-- MESSAGES in a state, not counts of events -- a patient who opens the same
-- email six times on the bus has opened it once for this purpose. The webhook
-- folds each event into the row it belongs to, keeping first-seen timestamps
-- and a tally, so both readings are available and neither needs a group-by
-- over an ever-growing event table.

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,

  -- Resend's own id for the message, and the only thing a webhook event
  -- carries that can find its way back here. Unique across accounts because it
  -- is unique at the provider, and because the webhook resolves the account
  -- FROM this row -- an event arrives with no clinic on it.
  provider_message_id text not null,

  -- Which campaign it went out for. Null for the one-off sends that are not a
  -- campaign at all: a "send test to me", an invoice email, a document link.
  -- Those are still recorded, because a bounce matters whatever sent it.
  rule_id uuid references automation_rules(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,

  recipient_email text not null,
  subject text,

  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  -- First open and first click, plus how many times. Unique-vs-total is the
  -- difference between "38% of patients read it" and "it was read 74 times",
  -- and a metric that cannot tell them apart is not worth showing.
  first_opened_at timestamptz,
  open_count integer not null default 0,
  first_clicked_at timestamptz,
  click_count integer not null default 0,
  -- The three ways it can fail, kept apart because they mean different things
  -- to whoever is looking: bounced is the address, complained is the patient
  -- pressing "spam", failed is Resend refusing to send at all.
  bounced_at timestamptz,
  bounce_kind text,
  complained_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  last_event_at timestamptz
);

create unique index email_messages_provider_id_uniq on email_messages (provider_message_id);
-- The campaign metrics query: every message for one rule, newest first.
create index email_messages_rule_idx on email_messages (account_id, rule_id, sent_at desc);
create index email_messages_patient_idx on email_messages (account_id, patient_id) where patient_id is not null;

comment on table email_messages is
  'One row per email handed to the provider, folded forward as delivery events arrive. Written only by the server and the webhook.';
comment on column email_messages.provider_message_id is
  'Resend''s message id. The webhook has nothing else to match an event on.';
comment on column email_messages.open_count is
  'Total opens. first_opened_at is what "opened" means in the metrics -- one patient, one open.';

alter table email_messages enable row level security;

-- Readable by the account's staff; written by nobody through the API. Every
-- write comes from the server -- the send path, and the webhook, which is
-- unauthenticated by nature and must never be able to reach a table through a
-- policy meant for staff.
create policy "staff read email_messages" on email_messages
for select using (account_id in (select my_member_account_ids()));

-- ---------------------------------------------------------------------
-- Folding an event into its message
--
-- In the database rather than the endpoint because the webhook is chatty and
-- out of order: Resend does not promise that `delivered` arrives before
-- `opened`, and a retry can deliver the same event twice. Doing this as a
-- single statement makes each event idempotent for the timestamps -- applying
-- it twice leaves them unchanged -- and means a burst of events for one
-- message cannot interleave into a lost update the way read-modify-write from
-- the endpoint would.
create or replace function record_email_event(
  p_provider_message_id text,
  p_event text,
  p_occurred_at timestamptz,
  p_detail text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update email_messages set
    delivered_at = case when p_event = 'email.delivered' then least(coalesce(delivered_at, p_occurred_at), p_occurred_at) else delivered_at end,

    first_opened_at = case when p_event = 'email.opened' then least(coalesce(first_opened_at, p_occurred_at), p_occurred_at) else first_opened_at end,
    open_count = case when p_event = 'email.opened' then open_count + 1 else open_count end,

    first_clicked_at = case when p_event = 'email.clicked' then least(coalesce(first_clicked_at, p_occurred_at), p_occurred_at) else first_clicked_at end,
    click_count = case when p_event = 'email.clicked' then click_count + 1 else click_count end,

    bounced_at = case when p_event = 'email.bounced' then least(coalesce(bounced_at, p_occurred_at), p_occurred_at) else bounced_at end,
    bounce_kind = case when p_event = 'email.bounced' then coalesce(p_detail, bounce_kind) else bounce_kind end,

    complained_at = case when p_event = 'email.complained' then least(coalesce(complained_at, p_occurred_at), p_occurred_at) else complained_at end,

    failed_at = case when p_event = 'email.failed' then least(coalesce(failed_at, p_occurred_at), p_occurred_at) else failed_at end,
    failure_reason = case when p_event = 'email.failed' then coalesce(p_detail, failure_reason) else failure_reason end,

    last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at)
  where provider_message_id = p_provider_message_id;

  get diagnostics v_found = row_count;
  -- False means no message with that id: an email sent before this table
  -- existed, or from another environment pointed at the same Resend account.
  -- The caller answers 200 regardless -- a webhook that errors on those gets
  -- retried forever and eventually switched off by the provider.
  return v_found;
end;
$$;

revoke execute on function record_email_event(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function record_email_event(text, text, timestamptz, text) to service_role;

comment on function record_email_event(text, text, timestamptz, text) is
  'Folds one Resend delivery event into its email_messages row. Idempotent for timestamps: applying the same event twice leaves them unchanged.';
