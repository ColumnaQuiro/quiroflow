-- "Add credit" (a general account top-up, not tied to any invoice) had no
-- way to record how the clinic actually received that money -- unlike
-- regular invoice payments (payments.method), which already track this.
-- account_credits.invoice_id is nullable (it's not always paying off a
-- specific invoice), so this can't just reuse the payments table; add the
-- same method concept directly here instead.
alter table account_credits add column method text check (method in ('card', 'cash', 'other'));
