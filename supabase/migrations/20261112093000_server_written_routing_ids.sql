-- Two columns on accounts are not settings. They are how QuiroFlow decides
-- WHICH clinic something belongs to, so nobody may type them -- owners
-- included:
--
--   stripe_connect_account_id
--     The connected Stripe account. The Connect webhook routes events by it,
--     disconnect.post.ts deauthorizes it with the platform key, and every
--     stripeClientFor() call acts on it. Until now the OAuth callback wrote it
--     with the user's own session, which meant any owner (and any role with
--     billing_config) could write it straight through PostgREST. Another
--     clinic's acct_ id is not secret -- the public booking page hands it out
--     with every deposit -- so one PATCH made the Connect webhook find two
--     accounts and drop the victim's events, and /api/stripe/connect/disconnect
--     then revoked the victim's connection outright.
--
--   messenger_page_id
--     The Facebook Page whose Messenger DMs land in this clinic's Inbox. The
--     webhook routes by it and trusts the platform app's signature for any
--     account, and Page ids are public, so typing another clinic's Page id
--     into Settings > WhatsApp delivered that clinic's Messenger
--     conversations to whoever typed it.
--
-- Both are now written only by the server, from flows that prove the account
-- owns what it claims: the Stripe OAuth callback (Stripe says which account
-- authorised us) and the Instagram connect (Meta hands over a Page token for
-- the Page the clinic ticked). Those use the service role, where auth.uid()
-- is null, which is what this trigger lets through -- the same test
-- accounts_guard_settings uses, so service-role scripts and Cypress tasks are
-- unaffected.

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
  return new;
end;
$$;

revoke all on function public.accounts_guard_server_written() from public, anon, authenticated;

drop trigger if exists accounts_guard_server_written on public.accounts;
create trigger accounts_guard_server_written
  before update on public.accounts
  for each row execute function public.accounts_guard_server_written();

-- One clinic per connected Stripe account, as messenger_page_id,
-- instagram_user_id and whatsapp_phone_number_id already are. The Connect
-- webhook's lookup assumes it; without the index a second row made it find
-- nothing and acknowledge the event unprocessed.
create unique index if not exists accounts_stripe_connect_account_id_key
  on public.accounts (stripe_connect_account_id)
  where stripe_connect_account_id is not null;
