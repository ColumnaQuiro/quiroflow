-- The GoCardless connection columns are routing ids, like
-- stripe_connect_account_id in 20261112093000_server_written_routing_ids:
-- gocardless_organisation_id is what the GoCardless webhook finds a clinic
-- by. Restated from that migration with the gocardless_* columns added, so a
-- member with billing_config cannot PATCH another clinic's organisation onto
-- their own account. The server writes them with the service role, which
-- this guard lets through (auth.uid() is null).

create or replace function public.accounts_guard_server_written()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.stripe_connect_account_id is distinct from old.stripe_connect_account_id then
    raise exception 'stripe_connect_account_id is set by connecting Stripe, not edited directly' using errcode = '42501';
  end if;
  -- Clearing it is allowed: it only gives a Page up, which is what leaving
  -- the Instagram ID empty in Settings > WhatsApp (its "disconnect") does.
  if new.messenger_page_id is not null and new.messenger_page_id is distinct from old.messenger_page_id then
    raise exception 'messenger_page_id is set by connecting Instagram, not edited directly' using errcode = '42501';
  end if;
  -- GoCardless (20261112060227): the webhook finds the clinic by its
  -- organisation, so typing another clinic's organisation id would route
  -- that clinic's collections here. Written only by the connect callback,
  -- from the organisation GoCardless itself names in the token exchange, and
  -- cleared by disconnecting -- all through the service role.
  if new.gocardless_organisation_id is distinct from old.gocardless_organisation_id
     or new.gocardless_environment is distinct from old.gocardless_environment
     or new.gocardless_verification_status is distinct from old.gocardless_verification_status
     or new.gocardless_connected_at is distinct from old.gocardless_connected_at then
    raise exception 'The GoCardless connection is set by connecting GoCardless, not edited directly' using errcode = '42501';
  end if;
  return new;
end;
$$;
