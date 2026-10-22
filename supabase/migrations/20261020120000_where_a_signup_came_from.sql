-- Until now nothing recorded where a sign-up came from, so the only way to
-- tell whether an account arrived through Google Ads was to line its
-- created_at up against the conversion column by eye -- which is a guess,
-- not attribution.
--
-- The browser knows: the ad link carries ?gclid=..., and the marketing site
-- keeps it for the session so it survives the walk from the landing page to
-- the sign-up form. /api/internal/notify-new-account writes it here once,
-- with the service role, straight after create_account_with_owner.
--
-- jsonb rather than a column per parameter: the set changes with whatever
-- the channel of the month sends, and none of it is ever queried by name
-- in a hot path.
alter table public.accounts
  add column if not exists signup_attribution jsonb;

comment on column public.accounts.signup_attribution is
  'How this account arrived: gclid and the utm_* set as the browser carried them, or the referring URL when there is neither. Written once at onboarding by the service role; never a clinic setting, so accounts_guard_settings (which returns early when auth.uid() is null) does not gate it.';
