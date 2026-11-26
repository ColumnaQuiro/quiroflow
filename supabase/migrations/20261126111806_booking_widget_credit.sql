-- Whether an embedded booking widget shows "Reservas online con QuiroFlow"
-- under itself on the clinic's site (public/embed.js builds the line; the
-- widget, pages/book/[slug].vue, tells it whether to).
--
-- The widget is a cross-site iframe, and a link inside an iframe is the
-- framed page's link, not the clinic's: until this, no clinic site embedding
-- it linked to QuiroFlow at all. The line is the clinic page's own <a>, so it
-- is.
--
-- Shown to everyone except a clinic that has BOUGHT its own look
-- (subscriptions.branding_addon, 20261111063546_patient_app_branding.sql) and
-- still has it. Deliberately not get_clinic_branding(): that one is also true
-- for a comped account, and on 26 Nov 2026 every account it was true for was
-- comped and none had bought the add-on -- including the clinic whose site is
-- the embed with the most traffic. Paying to take QuiroFlow's name off is the
-- reason to hide it; being comped is not.
--
-- An unknown slug answers false: nothing to credit.
create or replace function public.get_booking_widget_credit(p_slug text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select not coalesce(s.branding_addon and s.status not in ('locked', 'canceled'), false)
     from accounts a
     left join subscriptions s on s.account_id = a.id
     where a.slug = lower(btrim(p_slug))),
    false
  );
$function$;

revoke all on function public.get_booking_widget_credit(text) from public;
grant execute on function public.get_booking_widget_credit(text) to anon, authenticated;
