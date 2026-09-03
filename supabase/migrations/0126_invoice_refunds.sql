-- Refunds, PracticeHub-style: a refund is its own invoice (negative
-- total_cents), not a separate table -- it shows up in the account ledger
-- like any other invoice, and usePatientFinancialSummary's balance formula
-- (paidCents - sum(invoices.total_cents) + creditLedgerCents) nets it out
-- automatically since a negative total just subtracts less. Bookkeeping
-- only by design: this doesn't call Stripe's refund API, it's staff
-- recording that money went back to the patient by whatever means (cash,
-- a manual Stripe refund, etc.) -- same "we track it, we don't move the
-- money" boundary as the existing write-off action.
alter table invoices add column is_refund boolean not null default false;
alter table invoices add column refunds_invoice_id uuid references invoices(id) on delete set null;
