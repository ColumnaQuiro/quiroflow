-- Facebook lead ads, received by QuiroFlow itself rather than through n8n.
--
-- Until now the only way a Meta lead form reached a clinic was an n8n
-- workflow that listened for the Page's leadgen webhook and re-posted each
-- submission to /api/public/v1/leads. That works for exactly one clinic --
-- the one that built the workflow. A clinic now connects its Facebook Page in
-- Settings > Leads, the QuiroFlow Meta app subscribes to that Page's leadgen
-- field, and /api/whatsapp/webhook files the lead directly.
--
-- Two tables, split on who may read them:
--
--   lead_ad_pages       -- which Page belongs to which clinic, and how the
--                          connection is doing. Members read it (Settings shows
--                          it); only the server writes it.
--   lead_ad_page_tokens -- the Page access token that reads each lead. A
--                          credential, so deny-all like account_secrets: one
--                          per Page, which the (account_id, name) key of
--                          account_secrets cannot hold.

create table public.lead_ad_pages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  -- Unique across ALL accounts, not per account: the webhook finds the clinic
  -- from the page id alone, so a Page claimed twice would have no answer to
  -- "whose lead is this".
  page_id text not null unique,
  page_name text,
  -- What a submission says about marketing consent when the form itself asks
  -- nothing. A form with a consent checkbox answers per person, and that
  -- answer always wins; a form without one leaves it to the clinic, who wrote
  -- the form's privacy text and knows what it covers. Off by default: consent
  -- is stated, never inferred (see /api/public/v1/leads).
  form_submission_is_consent boolean not null default false,
  connected_at timestamptz not null default now(),
  connected_by uuid references team_members(id) on delete set null,
  -- The page's health, as Settings shows it. A connection that has silently
  -- stopped delivering looks exactly like a quiet week otherwise.
  last_lead_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  last_error_at timestamptz
);
create index lead_ad_pages_account_idx on public.lead_ad_pages (account_id);

alter table public.lead_ad_pages enable row level security;
create policy "members read their lead ad pages" on public.lead_ad_pages
  for select using (is_account_member(account_id));
select public.require_two_factor_on('public.lead_ad_pages');

create table public.lead_ad_page_tokens (
  page_id text primary key references public.lead_ad_pages(page_id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.lead_ad_page_tokens enable row level security;
-- No policies: deny-all for everyone but the service role, the same shape as
-- account_secrets. The revoke makes it explicit rather than trusting the
-- default grants.
revoke all on public.lead_ad_page_tokens from anon, authenticated;
select public.require_two_factor_on('public.lead_ad_page_tokens');
