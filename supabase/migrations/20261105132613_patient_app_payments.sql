-- Patients paying for their own visits from the app: ahead of a booked visit,
-- or for the one they have just had, with the card they saved there.
--
-- Off until the clinic turns it on (Settings > Payments). Paying an invoice
-- the clinic has already raised ("Pagar" on an unpaid invoice) is not behind
-- this: it has been offered wherever Stripe is set up since before this, and
-- still is. What this switches on is the patient raising the charge for a
-- visit themselves -- at the visit's own price, with nobody at the desk.
--
-- Named stripe_% so accounts_settings_permission already files it under
-- billing_config, the permission Settings > Payments is gated on.
--
-- Nothing else is new in the schema. The money lands as an ordinary invoice
-- on the appointment, a card payment carrying its PaymentIntent and a factura
-- issued when the money arrives -- the shape an online-booking deposit has
-- always had -- so the ledger, the cash-up and the visit's billing panel read
-- it with no change. See server/utils/appPayments.ts.
alter table public.accounts add column stripe_app_payments_enabled boolean not null default false;

comment on column public.accounts.stripe_app_payments_enabled is
  'Patients may pay ahead for a booked visit, or for one they have had, from the patient app with their saved card.';
