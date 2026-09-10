-- Bono value stops being account credit.
--
-- Until now a bono was recorded twice: the sessions counter (sessions_used /
-- sessions_total) AND an account_credits balance worth the same money. Buying
-- a Bono 12 for 528 EUR banked 528 EUR of spendable credit, and each visit
-- raised a 44 EUR invoice settled by a 'credit' payment that drew the balance
-- down. Both halves tracked the same prepaid value.
--
-- That double representation is what this release removes: a bono visit is now
-- a package_sessions row and nothing else, so remaining value is read off the
-- counter alone. The credit side has to be retired in the same release -- leave
-- it behind and every bono holder keeps a balance they could spend on something
-- else while still holding all their sessions.
--
-- This offsets rather than deletes. Nothing already written is touched; each
-- affected patient gets one new row that brings their bono-derived credit to
-- zero, so the transition is visible in their own ledger and is reversible by
-- inserting the inverse.
--
-- The rule, deliberately not based on matching the `reason` text (those strings
-- are the archaeology of several repair passes and are not trustworthy as a
-- classifier):
--
--   offset = min( max(total_credit - protected_credit, 0), unused_bono_value )
--
--   * capped at unused bono value, so no more is retired than the counter now
--     represents;
--   * floored at zero, so no patient's credit is pushed negative;
--   * protected_credit is credit that mentions no bono/package at all (4 rows
--     account-wide: a general PracticeHub credit, a couple with no reason set).
--     Subtracting it first is what keeps genuine account credit -- an
--     overpayment, a goodwill balance -- from being swallowed by a patient's
--     unrelated bono. Where the protected amount exceeds what the patient
--     actually holds, the offset lands at zero and they keep the balance: this
--     errs toward the patient on purpose.
--
-- On production this touches 173 patients and retires 25,637.57 EUR, leaving
-- 161.34 EUR of genuine non-bono credit standing. On a fresh database (CI,
-- local) there are no rows and it is a no-op.

with unused as (
  select patient_id,
         sum(round((sessions_total - sessions_used) * (price_cents::numeric / nullif(sessions_total, 0))))::bigint as unused_cents
  from package_purchases
  where sessions_used < sessions_total
  group by patient_id
),
cred as (
  select account_id, patient_id, sum(amount_cents)::bigint as credit_cents
  from account_credits
  group by account_id, patient_id
),
protected as (
  select patient_id, sum(amount_cents)::bigint as protected_cents
  from account_credits
  where reason is null
     or (reason not ilike '%bono%' and reason not ilike '%package%' and reason not ilike 'Applied to%')
  group by patient_id
),
offsets as (
  select c.account_id,
         c.patient_id,
         least(
           greatest(c.credit_cents - coalesce(p.protected_cents, 0), 0),
           coalesce(u.unused_cents, 0)
         ) as offset_cents
  from cred c
  left join unused u on u.patient_id = c.patient_id
  left join protected p on p.patient_id = c.patient_id
)
insert into account_credits (account_id, patient_id, amount_cents, reason)
select account_id,
       patient_id,
       -offset_cents,
       'Bono value is now tracked by the sessions counter, not as account credit'
from offsets
where offset_cents > 0;
