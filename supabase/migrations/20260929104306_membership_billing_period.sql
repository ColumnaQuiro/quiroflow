-- How often a membership plan charges.
--
-- Settings > Memberships only ever held a name and a price, labelled
-- "Price / period" with the period left for the reader to guess. The plan
-- now says it: every `billing_interval_count` `billing_interval`s, in the
-- same vocabulary payment_schedules and Stripe already use, so a patient's
-- autopay can start from the plan's own period instead of assuming a month.
--
-- Every existing plan gets "every 1 month", which is what the Billing tab's
-- autopay form has always defaulted to.
alter table memberships
  add column billing_interval text not null default 'month'
    check (billing_interval in ('week', 'month', 'year')),
  add column billing_interval_count integer not null default 1
    check (billing_interval_count between 1 and 12);
