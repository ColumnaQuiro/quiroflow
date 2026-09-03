-- Smart waitlist: when an appointment is cancelled, the freed slot is
-- offered to the oldest matching waiting patient via a claim link, instead
-- of the slot just sitting open until someone happens to book it. Modeled
-- as its own table (not reusing recall_candidates or care_plans) because a
-- waitlist entry has real workflow state (waiting -> offered -> booked/
-- expired), unlike those, which are both computed/inferred views over
-- appointments.
create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  -- null on either of these means "any" -- e.g. a patient happy to see
  -- whichever practitioner has the next opening, or open to any visit type.
  appointment_type_id uuid references appointment_types(id) on delete set null,
  practitioner_id uuid references team_members(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'expired', 'cancelled')),
  -- The next four are set only once an offer goes out, snapshotting the
  -- specific freed slot -- needed even when the entry itself has "any"
  -- practitioner/type, since the actual appointment created on claim has to
  -- reconstruct the exact cancelled slot, not the patient's looser preference.
  claim_token uuid unique,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  offered_room_id uuid references calendar_resources(id) on delete set null,
  offered_practitioner_id uuid references team_members(id) on delete set null,
  offered_appointment_type_id uuid references appointment_types(id) on delete set null,
  offered_starts_at timestamptz,
  offered_ends_at timestamptz,
  booked_appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index waitlist_entries_account_status_idx on waitlist_entries (account_id, status);
create unique index waitlist_entries_claim_token_idx on waitlist_entries (claim_token) where claim_token is not null;

alter table waitlist_entries enable row level security;

-- Normal staff CRUD (add/view/cancel entries) goes through this. The offer
-- and claim endpoints (server/api/waitlist/*) use the service-role client
-- instead, same reasoning as photo_upload_tokens: the claim page has no
-- session at all (it's a link sent to a patient's phone), so redemption
-- can't be RLS-gated by account membership.
create policy "staff manage waitlist_entries" on waitlist_entries
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- New campaign trigger: fires when a freed slot is offered to a waitlisted
-- patient. No appointment row exists yet at that point (claiming is what
-- creates it), so the message needs the two new merge tokens
-- (waitlist_claim_link, waitlist_slot_datetime) added in
-- runAutomationActions.ts rather than the usual next_appointment token.
alter table automation_rules drop constraint automation_rules_trigger_event_check;
alter table automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed',
    'appointment.cancelled', 'appointment.no_show', 'appointment.rescheduled',
    'appointment.same_day', 'appointment.hours_before', 'appointment.review_request',
    'invoice.paid', 'patient.birthday', 'patient.referred',
    'membership.new_member', 'membership.removed', 'membership.payment_processed',
    'waitlist.slot_offered'
  ]));
