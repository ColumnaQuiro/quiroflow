-- Reputation: reviews, and the requests that ask for them.
--
-- Worth being blunt about the split, because this screen looks like one
-- feature and is really two with very different footing.
--
-- The REVIEWS half is not ours. Ratings, review text and the ability to post
-- a reply all live inside Google Business Profile, Doctoralia and Facebook,
-- behind an OAuth integration per platform that does not exist yet. This
-- migration gives those importers a table to write to, and lets a clinic
-- enter a review by hand in the meantime. Until something fills it the screen
-- shows an empty state rather than invented numbers -- there is no way to
-- derive a Google rating from anything this app holds.
--
-- The REQUESTS half IS ours, end to end. The clinic sends the request, so we
-- know it was sent; the link goes through our own redirect, so we know it was
-- opened. Whether they then left a review is back on the platform's side of
-- the fence, and is recorded only when a platform import or a person says so.
-- That is why the funnel below can honestly report two of its three steps.

-- Where a review request sends people. Per account rather than per clinic for
-- now: a clinic with three locations usually points everyone at one Google
-- listing, and splitting it can wait until someone asks.
alter table accounts add column if not exists google_review_url text;

create table reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid references clinics(id) on delete set null,

  platform text not null check (platform in ('google', 'doctoralia', 'facebook', 'other')),
  -- The platform's own id for this review, so a re-import updates rather than
  -- duplicates. Null for a review typed in by hand.
  external_id text,

  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  body text,
  posted_at timestamptz not null,

  -- Set when the clinic has answered, by whatever route.
  replied_at timestamptz,
  reply_body text,
  reply_by_team_member_id uuid references team_members(id) on delete set null,
  -- True when the text came from the model rather than a person. Kept so
  -- "replied by AI, approved by Marta" can be said accurately later.
  reply_was_ai_drafted boolean not null default false,

  -- A draft waiting for a person. Deliberately separate from reply_body: a
  -- draft is not a reply, and conflating them is how an unapproved sentence
  -- ends up counted as sent.
  draft_body text,
  draft_created_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index reviews_platform_external_idx
  on reviews (account_id, platform, external_id) where external_id is not null;
create index reviews_account_posted_idx on reviews (account_id, posted_at desc);
-- Powers the "needs approval" count without scanning every review.
create index reviews_account_draft_idx on reviews (account_id) where draft_body is not null and replied_at is null;

create table review_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,

  -- The token in the link we send. Opening it is what we can actually
  -- observe, which is the middle step of the funnel.
  token text not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email')),

  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  -- Only ever set by a platform import or by a person saying so. We cannot
  -- see someone type a review on Google, and a guess here would be the one
  -- number on the screen a clinic might make decisions about.
  review_id uuid references reviews(id) on delete set null,

  created_at timestamptz not null default now()
);

create unique index review_requests_token_idx on review_requests (token);
create index review_requests_account_sent_idx on review_requests (account_id, sent_at desc);

alter table reviews enable row level security;
alter table review_requests enable row level security;

create policy "staff read reviews" on reviews
  for select using (is_account_member(account_id));
create policy "staff insert reviews" on reviews
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff update reviews" on reviews
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

create policy "staff read review_requests" on review_requests
  for select using (is_account_member(account_id));
create policy "staff insert review_requests" on review_requests
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

-- Recording that a link was opened happens with no session at all -- the
-- patient clicking it is not signed in to anything. A security definer
-- function keyed by the token is the same shape record_app_open uses, and it
-- deliberately returns nothing: the caller learns whether the token was real
-- only by being redirected, so this cannot be used to probe for valid tokens.
create or replace function record_review_request_opened(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update review_requests
  set opened_at = coalesce(opened_at, now())
  where token = p_token;
end;
$$;

revoke execute on function record_review_request_opened(text) from public;
grant execute on function record_review_request_opened(text) to anon, authenticated;

create or replace function reviews_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger reviews_touch_updated_at
  before update on reviews
  for each row
  execute function reviews_touch_updated_at();
