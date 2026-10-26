-- Someone is told when the AEAT has not accepted a record.
--
-- Until now a refused or unsent record was visible in exactly two places:
-- the verifactu-cron response, which nobody reads, and Settings > VeriFactu,
-- which nobody opens unless they already suspect something. Under VERI*FACTU
-- a record nobody is sending looks exactly like a quiet day, so from the
-- first production record on 1 Jan 2027 that is not enough.
-- server/utils/verifactuAlerts.ts now emails the clinic's owners and reports
-- to Sentry. This table is what makes each alert go out once, not once a
-- minute.
--
-- One row per thing alerted about:
--   kind 'record'      -- key is the factura_record id. Any record the AEAT
--                         has not accepted 15 minutes after it was generated,
--                         whatever the reason: refused, parked, a blocked
--                         certificate, an outage. One alert per record.
--   kind 'certificate' -- key is '<not_after>:<threshold>', so a certificate
--                         is announced at 30 days and again at 7, and a
--                         renewed one (a new not_after) starts over.
--
-- The insert IS the claim: the sender inserts with on conflict do nothing and
-- only emails for the rows that came back, so two overlapping ticks cannot
-- both send.
create table verifactu_alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('record', 'certificate')),
  key text not null,
  sent_at timestamptz not null default now(),
  unique (account_id, kind, key)
);

-- Without the grant the service role itself is refused in production.
select public.grant_data_api('public.verifactu_alerts');

alter table verifactu_alerts enable row level security;

-- No policy: written and read only by the cron, with the service role.
select public.require_two_factor_on('public.verifactu_alerts');

comment on table verifactu_alerts is
  'What the VeriFactu sender has already alerted owners about (unaccepted records, expiring certificates), so each alert is sent once. Service role only.';

-- Records ALREADY unaccepted when this ships count as alerted. They are
-- test-chain records from September, refused for bugs since fixed, and known;
-- without this every one of them would email on the first tick after the
-- deploy, for nothing anyone can act on.
insert into verifactu_alerts (account_id, kind, key)
select s.account_id, 'record', w.factura_record_id::text
from factura_records_awaiting_aeat_summary() s
cross join lateral factura_records_awaiting_aeat(s.account_id) w
on conflict do nothing;
