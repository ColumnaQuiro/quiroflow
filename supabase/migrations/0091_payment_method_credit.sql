-- "Credit on account" payments were previously recorded with method 'other',
-- indistinguishable after the fact from a genuine cash-equivalent "other"
-- payment -- the Account Ledger needs to label these correctly. No backfill
-- of historical 'other' rows: which of those were actually credit applications
-- can't be reconstructed reliably.
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('card', 'cash', 'other', 'credit'));
