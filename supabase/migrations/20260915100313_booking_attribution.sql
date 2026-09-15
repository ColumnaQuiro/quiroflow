-- Where a public booking actually came from.
--
-- Today an online booking arrives with nothing but `source = 'online'`. A
-- patient who clicks a Meta ad, lands on the clinic's site, and books through
-- the widget is indistinguishable from one who typed the URL in. That is not
-- hypothetical: of 437 leads in the clinic's Meta Leads Center, 68 are
-- already patients, and the booking rows say nothing about any of it. The one
-- that prompted this -- a lead from 11 Sep who booked herself on 14 Sep --
-- looked, from inside QuiroFlow, like she appeared from nowhere.
--
-- A separate table rather than columns on `appointments`, for three reasons:
-- the data is optional and sparse (most bookings will have none of it), it is
-- marketing data rather than clinical, and `appointments` is read on every
-- calendar paint -- there is no reason to widen that row for something only a
-- report looks at. Mirrors lead_attribution, which exists for the same job on
-- the other side of the funnel.
create table booking_attribution (
  appointment_id uuid primary key references appointments(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,

  -- The ad platforms each stamp their own click id on the landing URL:
  -- fbclid (Meta), gclid (Google), ttclid (TikTok), msclkid (Microsoft).
  -- Stored as one value plus which platform it came from, so adding a
  -- platform later needs no migration -- and so a row can be joined back to
  -- the platform's own reporting, which is the whole point of keeping it.
  click_id text,
  click_id_source text,

  -- Where the browser came from and which page it landed on. The referrer is
  -- what catches an organic or a link-in-bio visit, which carries no utm at
  -- all and would otherwise be indistinguishable from direct.
  referrer text,
  landing_path text,

  created_at timestamptz not null default now()
);

create index booking_attribution_account_created_idx on booking_attribution (account_id, created_at desc);

alter table booking_attribution enable row level security;

-- Staff can read their own account's attribution -- it is the point of
-- collecting it, and it names no patient: the appointment id is opaque and
-- everything else describes an ad, not a person.
create policy "staff can view their account's booking attribution"
  on booking_attribution for select
  using (is_account_member(account_id));

-- Written only by the server route that handles a just-completed booking
-- (server/api/public-booking/attribution.post.ts), which runs as the service
-- role. Nothing writes it from a browser, so no insert/update/delete policy
-- exists -- RLS with no policy for an action is deny-all for every role
-- except service_role.
revoke insert, update, delete on booking_attribution from anon, authenticated;
