-- Online booking can ask for a card, so a missed visit or a late cancellation
-- can be charged to it -- the fees in Settings > Scheduling Policies, which
-- staff already charge to "the card on file" from the cancel step and, now,
-- from a no-show.
--
--   accounts.online_booking_card_on_file  after an online booking, send the
--     patient to Stripe's own card page (a Checkout session in setup mode,
--     the same page staff send with "Card link"), which saves the card to
--     their Stripe customer. Under clinic_config, as every online_booking_*
--     column is.
--
-- get_public_booking_policy is what the booking page shows before anyone
-- books: the fees and the notice they apply inside, and whether a card will
-- be asked for. Nothing else about the clinic -- the page is public.
--
-- Additive only.
alter table public.accounts
  add column if not exists online_booking_card_on_file boolean not null default false;

create or replace function public.get_public_booking_policy(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card_on_file', a.online_booking_card_on_file and a.stripe_publishable_key is not null,
    'cancellation_fee_cents', a.cancellation_fee_cents,
    'missed_appointment_fee_cents', a.missed_appointment_fee_cents,
    'notice_hours', a.patient_app_change_notice_hours
  )
  from public.accounts a
  where a.slug = p_slug
$$;
grant execute on function public.get_public_booking_policy(text) to anon, authenticated;
