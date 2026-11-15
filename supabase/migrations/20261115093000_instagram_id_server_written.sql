-- instagram_user_id is a routing id: the webhook hands every Instagram DM to
-- the one account holding the recipient's id. It was the last of those still
-- writable from the browser, only because Settings > WhatsApp let a clinic
-- paste it by hand. That form is gone -- connecting goes through
-- /api/meta/instagram/connect, which reads the id from the clinic's own Meta
-- grant -- so a member typing an id now could only ever mean claiming an
-- Instagram account that is not theirs, and its DMs with it.
--
-- Restated from 20261112130135_gocardless_ids_server_written with
-- instagram_user_id added. Clearing is still allowed, as for
-- messenger_page_id: it only gives an account up. The server writes both with
-- the service role, which this lets through (auth.uid() is null).

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
  -- Clearing it is allowed: it only gives a Page up. Disconnecting is done
  -- by the server now (DELETE /api/meta/instagram), but clearing was never
  -- the risk.
  if new.messenger_page_id is not null and new.messenger_page_id is distinct from old.messenger_page_id then
    raise exception 'messenger_page_id is set by connecting Instagram, not edited directly' using errcode = '42501';
  end if;
  if new.instagram_user_id is not null and new.instagram_user_id is distinct from old.instagram_user_id then
    raise exception 'instagram_user_id is set by connecting Instagram, not edited directly' using errcode = '42501';
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
