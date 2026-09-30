-- One paid event per Stripe invoice.
--
-- Stripe delivers webhooks at least once. The invoice.paid handler
-- (server/utils/stripeWebhookHandlers.ts) now checks for a paid event already
-- recorded against the Stripe invoice before booking anything, which covers a
-- redelivery that arrives after the first has finished. Two deliveries in
-- flight at once can both pass that check; this index lets exactly one of
-- them record its event, and the handler treats the other's unique violation
-- as "already booked".
--
-- Partial: a failed attempt and a later successful one share an invoice id
-- legitimately, and so can several failed attempts. Only 'paid' is once.
--
-- Created only when the data already satisfies it. A duplicate paid event
-- left by the old handler would otherwise fail this migration in the
-- automated apply, and with it every migration queued behind it. The handler
-- is correct without the index (it only narrows the race), so if duplicates
-- exist this warns, skips, and leaves them for someone to look at rather than
-- guessing which of two booked charges is the real one.
do $$
begin
  if exists (
    select 1
    from public.stripe_payment_events
    where status = 'paid' and stripe_invoice_id is not null
    group by stripe_invoice_id
    having count(*) > 1
  ) then
    raise warning 'stripe_payment_events has more than one paid event for some Stripe invoice; stripe_payment_events_paid_invoice_uniq not created';
  else
    create unique index if not exists stripe_payment_events_paid_invoice_uniq
      on public.stripe_payment_events (stripe_invoice_id)
      where status = 'paid' and stripe_invoice_id is not null;
  end if;
end;
$$;
