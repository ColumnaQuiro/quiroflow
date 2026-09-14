-- What the Growth dashboard needs that the leads table alone cannot answer.
--
-- Two additions, for two different reasons.
--
-- 1. leads.furthest_stage
--
-- The board shows where a lead IS. The funnel has to show where leads have
-- BEEN: a lead sitting in 'converted' also passed through 'booked' and
-- 'showed', and counting current stages would report Booked as 2 in a month
-- when twenty people were booked. Every funnel number would be wrong, and
-- wrong in the flattering direction for the stages nobody reaches.
--
-- Derivable from lead_events, but only by reading every event for every lead
-- on every dashboard load. A column maintained by the same trigger that
-- already owns stage_changed_at costs one comparison per update instead.
--
-- 'lost' is deliberately not on the ladder. A lead that reached Booked and
-- then went Lost still reached Booked -- that is exactly the drop-off the
-- funnel exists to show -- so moving to 'lost' leaves furthest_stage alone.

create or replace function lead_stage_rank(stage text)
returns integer
language sql
immutable
as $$
  select case stage
    when 'new' then 0
    when 'contacted' then 1
    when 'qualified' then 2
    when 'booked' then 3
    when 'showed' then 4
    when 'converted' then 5
    else -1            -- 'lost', and anything a later migration adds
  end;
$$;

alter table leads add column furthest_stage text not null default 'new';

-- Backfill for rows that already exist. New rows are handled by the trigger
-- below, which this migration re-points at INSERT as well as UPDATE.
-- Today's rows have only ever had their current stage, and 'lost'
-- rows have no record of what they reached before they were lost. Setting
-- those to 'new' rather than guessing keeps the funnel honest -- it will
-- under-report historical drop-off rather than invent it.
update leads
set furthest_stage = case when lead_stage_rank(stage) >= 0 then stage else 'new' end;

create index leads_account_furthest_idx on leads (account_id, furthest_stage) where deleted_at is null;

create or replace function leads_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- INSERT as well as UPDATE. A lead does not always start at 'new': the AI
  -- receptionist books people on first contact, a walk-in is booked at the
  -- desk, and an importer arrives with whatever stage the old system had.
  -- With an update-only trigger every one of those kept furthest_stage at
  -- its default and never counted in the funnel at all -- the stages the
  -- tier is sold on would have under-reported exactly the leads it handled
  -- best.
  if tg_op = 'INSERT' then
    if lead_stage_rank(new.stage) > lead_stage_rank(new.furthest_stage) then
      new.furthest_stage := new.stage;
    end if;
    return new;
  end if;

  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    -- Only ever moves forward. A lead dragged back from Booked to Contacted
    -- to correct a mistake has still been booked, and the funnel should keep
    -- saying so.
    if lead_stage_rank(new.stage) > lead_stage_rank(old.furthest_stage) then
      new.furthest_stage := new.stage;
    end if;
  end if;
  return new;
end;
$$;

-- Re-pointed at both operations. The original trigger (in the leads
-- migration) is update-only; dropping and recreating it here is what makes
-- the insert path above reachable.
drop trigger if exists leads_touch_updated_at on leads;
create trigger leads_touch_updated_at
  before insert or update on leads
  for each row
  execute function leads_touch_updated_at();

-- 2. channel_spend
--
-- Cost per lead, cost per new patient and ROAS are the numbers that justify
-- the tier's price, and none of them can be computed from anything this app
-- holds: the money was spent inside Google Ads and Meta. Importing it needs
-- an OAuth integration per platform that does not exist yet.
--
-- This is the table that integration will write to, and that a clinic can
-- fill in by hand in the meantime -- "we spent €1,480 on Google Ads in
-- September" is a thing an owner knows and can type in one line. Without it
-- the dashboard has to render those three KPIs as "—" forever; with it they
-- are real the moment anyone enters a number.
--
-- Monthly granularity, because that is how ad budgets are actually discussed
-- and reported, and because a daily table would demand a precision the
-- manual path cannot honestly supply.
create table channel_spend (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,

  -- Matched against leads.source, which is free text ("Meta Ads · Sciatica").
  -- Stored as the channel prefix ("Meta Ads") and matched by prefix, so one
  -- spend row covers every campaign variant a clinic runs under it.
  channel text not null,

  -- First day of the month this spend covers. A date rather than a range:
  -- one row per channel per month, enforced below.
  period_month date not null,
  amount_cents integer not null check (amount_cents >= 0),

  -- Who said so. 'manual' today, 'google_ads'/'meta_ads' once the importers
  -- exist -- which is also how a later import knows it may overwrite a
  -- hand-entered figure rather than duplicating it.
  source text not null default 'manual' check (source in ('manual', 'google_ads', 'meta_ads')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index channel_spend_account_channel_month_idx
  on channel_spend (account_id, channel, period_month);
create index channel_spend_account_month_idx on channel_spend (account_id, period_month desc);

alter table channel_spend enable row level security;

-- Spend is a money figure the whole clinic's acquisition maths rests on, so
-- writing it is gated on the same permission as the rest of Growth rather
-- than on membership alone.
create policy "staff read channel_spend" on channel_spend
  for select using (is_account_member(account_id));
create policy "staff write channel_spend" on channel_spend
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff update channel_spend" on channel_spend
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff delete channel_spend" on channel_spend
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
