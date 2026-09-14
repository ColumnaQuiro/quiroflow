-- What the AI receptionist is, knows, and is allowed to do.
--
-- One row per account. Structured columns for the things that are decisions
-- (how far ahead it may book, how much notice it needs) and jsonb for the
-- things that are lists whose shape belongs to the integration rather than to
-- us (knowledge cards, escalation rules). This is the material a system
-- prompt gets built from, which is why it is data rather than one free-text
-- box: a textarea cannot be validated, diffed, or reasoned about by the
-- booking code that has to honour it.

create table receptionist_config (
  account_id uuid primary key references accounts(id) on delete cascade,

  -- OFF until somebody turns it on, deliberately. A config row appears the
  -- first time anyone opens the screen, and a receptionist that started
  -- answering real patients because a default was true would be the worst
  -- possible failure mode this table could have.
  enabled boolean not null default false,

  persona_name text not null default 'Alba',
  languages text[] not null default array['es', 'en'],
  tone text not null default 'warm_brief'
    check (tone in ('warm_brief', 'clinical', 'chatty', 'formal')),
  -- The guardrail sentence. Kept as prose on purpose: it is read by the model,
  -- not by code, and the clinic's own wording is the point.
  never_says text not null default 'No diagnosis, no treatment promises, no claims about insurers. Refers red flags to a chiropractor within one reply.',

  -- [{ id, title, lines[], footnote }]. Shape belongs to whatever writes it --
  -- some cards are typed by hand, others will be synced from Billing and
  -- Calendar, and a column per card would be a migration per card.
  knowledge jsonb not null default '[]'::jsonb,
  -- ["What brings you in?", ...] in the order the AI should ask them.
  qualification_questions jsonb not null default '[]'::jsonb,
  -- [{ rule, action }]. Read by the model today; the booking code will read
  -- the same rows when it can act on them.
  escalation_rules jsonb not null default '[]'::jsonb,

  -- Booking rules. Columns, not jsonb: these are constraints the booking code
  -- must enforce, and a typo in a jsonb key would fail silently where a typo
  -- in a column name does not compile.
  booking_window_days integer not null default 14 check (booking_window_days between 1 and 90),
  minimum_notice_minutes integer not null default 120 check (minimum_notice_minutes >= 0),
  slots_per_reply integer not null default 2 check (slots_per_reply between 1 and 5),
  -- Which appointment types it may book at all. Empty means none, which is
  -- the safe reading: an unconfigured receptionist books nothing.
  bookable_appointment_type_ids uuid[] not null default '{}',

  after_hours boolean not null default true,
  missed_call_text_back boolean not null default true,
  answer_during_hours boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table receptionist_config enable row level security;

-- Reading is membership; changing what the AI says to patients is the Growth
-- permission, same split the rest of the tier uses.
create policy "staff read receptionist_config" on receptionist_config
  for select using (is_account_member(account_id));
create policy "staff insert receptionist_config" on receptionist_config
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff update receptionist_config" on receptionist_config
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

create or replace function receptionist_config_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger receptionist_config_touch_updated_at
  before update on receptionist_config
  for each row
  execute function receptionist_config_touch_updated_at();
