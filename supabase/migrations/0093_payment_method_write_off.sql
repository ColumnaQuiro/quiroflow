-- A write-off settles an invoice's remaining balance without real money
-- changing hands (e.g. waiving a small unpaid amount) -- recorded as a
-- payments row like any other settlement so the existing "paidCents >=
-- total_cents -> status paid" logic used everywhere else keeps working
-- unchanged, just tagged with its own method so the ledger can label it
-- honestly instead of lumping it in with 'other'.
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('card', 'cash', 'other', 'credit', 'write_off'));
