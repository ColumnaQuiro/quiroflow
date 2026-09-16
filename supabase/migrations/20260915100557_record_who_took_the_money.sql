-- Record who took the money.
--
-- `payments` and `facturas` were the two money tables with no author on them.
-- Every other staff-written table has carried created_by for a long time
-- (account_credits, package_purchases, care_plans, availability_blocks, ...),
-- and audit_logs covers only `patient` and `appointment` rows -- 3767 and 2834
-- of them, and nothing else has ever been written to it. So for a payment the
-- only way to answer "who did this" was to find whoever happened to touch the
-- appointment around the same minute and assume it was also them.
--
-- That came up on 2026-09-15: two EUR 44 cash payments, one of which looks
-- like it was taken against a bono that had already been paid off in full.
-- Answering "who was at the desk" meant reasoning from an appointment status
-- change one minute earlier, which is an inference, not a record. A factura is
-- a numbered fiscal document -- correcting one needs a rectificativa, not a
-- quiet delete -- and issuing it with nobody's name against it is a thin trail
-- for something that formal.
--
-- Stamped by trigger rather than by the callers. There are five payment insert
-- sites (BillingTab x4, NewAppointmentPanel) and two for facturas
-- (useFacturas, facturas.ts server-side), and a rule that every future one must
-- remember a field is a rule that gets forgotten -- which is how this column
-- came to be missing here while existing everywhere else. The trigger cannot be
-- forgotten.
--
-- NULL keeps a real meaning: nobody was at a screen. Stripe autopay on a bono
-- and membership renewals both insert through the service role, where
-- auth.uid() is null and so current_team_member_id() is too -- see the comment
-- on issueFacturaServer, which exists precisely because money arrives that way.
-- A null author is therefore "the system took this", which is worth being able
-- to tell apart from a person, and is also what every row written before today
-- honestly is: unknown and unknowable, since nothing recorded it at the time.
-- No backfill for that reason.

alter table payments add column created_by uuid references team_members(id) on delete set null;
alter table facturas add column created_by uuid references team_members(id) on delete set null;

comment on column payments.created_by is
  'Team member who recorded this payment, or null when it came in without a human (Stripe autopay, membership renewal, or any row predating 20260915100557). Stamped by stamp_created_by().';
comment on column facturas.created_by is
  'Team member who issued this factura, or null when nobody was at a screen. Stamped by stamp_created_by().';

-- Account-scoped on purpose. my_team_member_id() takes no argument and so
-- ends in `limit 1` over every team_members row for the current user; nobody
-- currently belongs to two accounts, but the day someone does, that picks a
-- row arbitrarily and would stamp a payment with the identity they hold in a
-- different clinic. current_team_member_id(account_id) cannot do that. A
-- column DEFAULT can't read another column, which is why this is a trigger.
create or replace function stamp_created_by()
returns trigger
language plpgsql
as $$
begin
  -- Only fills a gap, never overwrites. An importer or a backfill that knows
  -- better than auth.uid() -- attributing historical rows to the person who
  -- actually took the money -- passes created_by explicitly and keeps it.
  if new.created_by is null then
    new.created_by := current_team_member_id(new.account_id);
  end if;
  return new;
end;
$$;

-- Deliberately not SECURITY DEFINER. current_team_member_id is already
-- definer and does the privileged read of team_members; this wrapper needs
-- no elevation of its own, so it doesn't get any.

create trigger payments_stamp_created_by
  before insert on payments
  for each row execute function stamp_created_by();

create trigger facturas_stamp_created_by
  before insert on facturas
  for each row execute function stamp_created_by();
