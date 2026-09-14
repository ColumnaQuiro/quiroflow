-- The leads pipeline: the first Growth tier feature to get real storage.
--
-- Until now every Growth screen has read a fixture from its composable. This
-- is the table the board, the drawer and the stage drag have been written
-- against, so the shapes below deliberately match what those screens already
-- consume rather than being designed fresh.
--
-- A lead is a stranger who has enquired and has no patient record yet. That
-- is the whole distinction from `patients`: converting one is what creates
-- the patient row, and `patient_id` below is how a converted lead keeps
-- pointing at what it became. Leads are NOT patients with a flag -- a patient
-- row carries clinical and billing obligations that an anonymous Instagram DM
-- must not create.

create table leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  -- Which location the enquiry is for. Nullable because it is often unknown
  -- at first contact -- the AI receptionist asks, and a walk-in already knows.
  clinic_id uuid references clinics(id) on delete set null,

  -- Human-facing identifier ("LEAD-2026-0918"), shown in the drawer so staff
  -- and patients can refer to the same thing out loud. Unique per account,
  -- not globally: two clinics may both have their own 0918.
  reference text not null,

  full_name text not null,
  phone text,
  email text,

  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'qualified', 'booked', 'showed', 'converted', 'lost')),
  -- How they reached us. Distinct from `source`, which is the campaign or
  -- referrer the enquiry is attributed to -- a WhatsApp message can come from
  -- a Meta ad, a Google listing or a friend, and the board shows both.
  channel text not null
    check (channel in ('whatsapp', 'sms', 'phone', 'web', 'instagram', 'walk_in')),
  source text,

  -- Cents, like every other money column here (patients.balance_cents,
  -- services.default_price_cents). Nullable: an enquiry that has not been
  -- qualified has no meaningful estimate yet, and 0 would drag the stage
  -- totals down as though it were worth nothing.
  estimated_value_cents integer check (estimated_value_cents is null or estimated_value_cents >= 0),

  owner_team_member_id uuid references team_members(id) on delete set null,

  -- Set when the lead is converted. on delete set null rather than cascade:
  -- deleting a patient record must not erase the acquisition history that
  -- explains what the clinic paid to get them.
  patient_id uuid references patients(id) on delete set null,
  converted_at timestamptz,

  -- True while the AI receptionist is mid-conversation and a person should
  -- not also be typing. The Inbox reads this to decide whether to show
  -- "Take over".
  ai_handling boolean not null default false,

  -- Separate from updated_at so "time in stage" -- the number the board
  -- shows on every card -- survives an unrelated edit to the name or phone.
  stage_changed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete, matching patients and appointments: a deleted lead still
  -- has to be excludable from spend-per-patient maths without losing the row.
  deleted_at timestamptz
);

create unique index leads_account_reference_idx on leads (account_id, reference);
-- The board's own query: every open lead for an account, newest movement
-- first, grouped by stage in the API.
create index leads_account_stage_idx on leads (account_id, stage) where deleted_at is null;
create index leads_account_created_idx on leads (account_id, created_at desc) where deleted_at is null;
-- "Is this person already a lead?" on an inbound message, by either handle.
create index leads_account_phone_idx on leads (account_id, phone) where phone is not null and deleted_at is null;
create index leads_account_email_idx on leads (account_id, email) where email is not null and deleted_at is null;

-- One ordered feed per lead rather than per-source feeds a screen would have
-- to interleave: a form submission, the AI's WhatsApp conversation, what it
-- concluded, the appointment it booked, the reminder, the visit. The drawer
-- renders whatever it is handed, in occurred_at order.
create table lead_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,

  kind text not null
    check (kind in ('form', 'conversation', 'qualification', 'appointment', 'reminder', 'note', 'stage_change')),
  title text not null,
  detail text,

  -- The parts that differ per kind: a transcript for 'conversation', the
  -- verdict and checks for 'qualification', the slot for 'appointment'.
  -- jsonb rather than a column per kind, because every new event type would
  -- otherwise be a migration, and most of these come from integrations whose
  -- payloads are not ours to design.
  body jsonb,

  -- When it happened, which is not when we heard about it: an ad platform
  -- can deliver a form submission minutes late, and the timeline must still
  -- read in the order the patient experienced it.
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index lead_events_lead_idx on lead_events (lead_id, occurred_at);
create index lead_events_account_idx on lead_events (account_id);

-- One row per lead, kept apart from `leads` for two reasons: the board reads
-- 50+ leads and needs none of it, and attribution arrives on its own
-- schedule -- an ad platform backfills cost and campaign data hours or days
-- after the lead itself, and re-attributes later still.
create table lead_attribution (
  lead_id uuid primary key references leads(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,

  campaign text,
  ad text,
  audience text,
  first_touch text,
  last_touch text,

  -- What this specific lead cost to acquire. Feeds cost-per-lead and
  -- cost-per-new-patient on the Growth dashboard.
  cost_cents integer check (cost_cents is null or cost_cents >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_attribution_account_idx on lead_attribution (account_id);

-- RLS: tenancy only, exactly as the rest of the schema does it. Whether a
-- given staff member may see Growth at all is a permission
-- (communication_config), enforced in the API layer by requirePermission --
-- the same split every other permissioned area uses, because RLS has no
-- access to the role catalogue without a round trip per row.
alter table leads enable row level security;
alter table lead_events enable row level security;
alter table lead_attribution enable row level security;

create policy "staff read leads" on leads
  for select using (is_account_member(account_id));
create policy "staff insert leads" on leads
  for insert with check (is_account_member(account_id));
create policy "staff update leads" on leads
  for update using (is_account_member(account_id));

create policy "staff read lead_events" on lead_events
  for select using (is_account_member(account_id));
create policy "staff insert lead_events" on lead_events
  for insert with check (is_account_member(account_id));

create policy "staff read lead_attribution" on lead_attribution
  for select using (is_account_member(account_id));
create policy "staff insert lead_attribution" on lead_attribution
  for insert with check (is_account_member(account_id));
create policy "staff update lead_attribution" on lead_attribution
  for update using (is_account_member(account_id));

-- No delete policy on any of the three. Leads are soft-deleted via
-- deleted_at, and lead_events is an audit trail of what was said to a
-- patient -- neither should be removable with a single REST call.

-- Stamps stage_changed_at only when the stage actually moves, so "2 d in
-- stage" on the board is not reset by someone correcting a phone number.
-- In a trigger rather than in the API because the stage is also moved by
-- automations and by the AI receptionist booking an appointment, and all
-- three paths have to agree.
create or replace function leads_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger leads_touch_updated_at
  before update on leads
  for each row
  execute function leads_touch_updated_at();
