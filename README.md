# QuiroFlow

Practice management for multi-location chiropractic/allied-health clinics —
scheduling with room auto-assignment, patient records with clinical notes
and Docs (a Tally.so-style form builder), billing/invoicing, packages
("bonos")/memberships with Stripe-automated recurring billing, WhatsApp
recalls and appointment confirmations, a reports dashboard, a public
booking widget on a per-clinic subdomain, and a migration path from
PracticeHub (CSV + a real API integration).

Built with Nuxt 3 + TypeScript + Tailwind, Supabase (Postgres + Auth +
Storage + RLS), Stripe, Meta's WhatsApp Cloud API, and Resend for email.
Deployed on Netlify.

**Node**: this project needs Node ≥20.19 / ≥22.12 (oxc-parser's native
bindings, used by Nuxt's route-meta parsing, don't ship for older 20.x
patches). A `.nvmrc` pins Node 22; run `nvm use` before installing/running
if you have nvm.

## Production

Live at **https://app.quiroflow.com**, deployed on Netlify with continuous
deployment from `main` (`ColumnaQuiro/quiroflow`). `quiroflow.com`'s bare
apex is reserved for a separate marketing site and isn't part of this app.
Each clinic gets a public booking page at `<slug>.app.quiroflow.com`.

## 1. Install

```bash
nvm use   # if you use nvm
npm install
```

## 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. Copy the Project URL and publishable key from Project Settings → API.
3. `cp .env.example .env` and fill in `NUXT_PUBLIC_SUPABASE_URL` /
   `NUXT_PUBLIC_SUPABASE_KEY`.
4. Run the SQL migrations in `supabase/migrations/` in order (via the
   Supabase SQL editor, the CLI, or the Supabase MCP server) to create the
   schema.
5. For server routes with no signed-in user (Stripe/WhatsApp webhooks),
   also set `NUXT_SUPABASE_SECRET_KEY` (Project Settings → API →
   `service_role`/`sb_secret_...` secret).

`types/database.types.ts` is hand-maintained, not CLI-generated — after any
schema change, regenerate types and merge in just the changed table blocks,
keeping the file's alphabetical ordering.

## 3. Set up Resend (email)

Get an API key at [resend.com](https://resend.com) and set
`NUXT_RESEND_API_KEY` in `.env`. Only affects password-reset emails —
everything else works without it.

## 4. Run it

```bash
npm run dev
```

Visit http://localhost:3000. Booking subdomains work locally too, via
`*.localtest.me` (public DNS that resolves to 127.0.0.1) — no `/etc/hosts`
changes needed.

## 5. Deploying (Netlify)

Deploys run through **`.github/workflows/deploy.yml`**, not Netlify's own
git integration. Netlify gates git-based continuous deployment for a
private, organization-owned repo behind its Pro plan, and this repo is
private — so GitHub Actions builds on every push to `main` and ships the
result with `netlify-cli deploy --prod`. It needs a `NETLIFY_AUTH_TOKEN`
**repository** secret (an org-level one silently resolves to empty in a
private repo on a Free-plan org) and carries the site id inline, which
isn't sensitive.

Two site settings can break this in ways the error messages don't explain:
Netlify's "Enforce deployment methods" must not be restricted to Git-based
production branches (it blocks CLI deploys to production while still
allowing drafts, surfacing only as `JSONHTTPError: Forbidden`), and
`netlify.toml`'s `publish` must match what the build actually writes —
a dashboard setting silently overrides this file on Netlify's own builds,
so a wrong value here stays invisible until something deploys via the CLI.

`nuxt.config.ts` sets Nitro's `netlify` preset; `netlify.toml` pins
`NODE_VERSION = "22"` (Netlify's build image otherwise may not satisfy
oxc-parser's engine requirement) and points `publish` at `dist` — Nitro's
netlify preset writes the SSR function to `.netlify/functions-internal` and
static assets to `dist`, not the `.output/public` other presets use.

Required environment variables in Netlify (Site configuration → Environment
variables): everything in `.env.example`, plus `NUXT_PUBLIC_APP_DOMAIN` set
to the real domain (e.g. `app.quiroflow.com`) so booking-subdomain routing
resolves correctly in production.

Wildcard clinic subdomains need two things once, and one more per clinic:
1. A wildcard DNS record: `*.app` (CNAME) → the site's `<name>.netlify.app`
   default domain.
2. `app.quiroflow.com` itself registered as the site's custom domain.
3. **Per clinic**: `<slug>.app.quiroflow.com` added as a Netlify domain
   alias (Netlify's `domain_aliases` field rejects wildcard syntax, so each
   clinic's subdomain needs registering individually — up to 100 per site).
   Automated now — `/onboarding` calls `/api/internal/register-clinic-subdomain`
   right after account creation, using `NETLIFY_AUTH_TOKEN` +
   `NETLIFY_SITE_ID` (see `.env.example`). Without those set, it silently
   no-ops and the alias needs adding manually instead.

### Developer portal subdomain

The public API documentation lives at **https://developers.quiroflow.com**
and is served by this same site — there is no second build. It needs one
thing once:

- `developers.quiroflow.com` added as a Netlify **domain alias** (Domain
  management → Add domain alias), pointing at the same site, with a DNS
  CNAME to the site's `<name>.netlify.app` default domain.

No redirect rule is required. The pages live at `pages/developers/*`, and
the `pages:extend` hook in `nuxt.config.ts` registers a prefix-free alias
route for each of them, so `developers.quiroflow.com/authentication` and
`app.quiroflow.com/developers/authentication` both resolve the same
component — server-side and in the browser. A CDN rewrite would have broken
the second of those: the server would render `/developers/authentication`
while the browser's URL said `/authentication`, and the client-side router
would fail to match it.

The docs subdomain's root (`/`) is redirected to `/introduction` by
`middleware/account.global.ts`, since `/` on the app host is the staff
sign-in entry point and can't be two pages at once.

Portal pages set `robots: index, follow` per-page, overriding the app-wide
`noindex` in `nuxt.config.ts`, and canonicalise to
`developers.quiroflow.com` so the `/developers/*` copies on the app host
don't compete in search results.

`robots.txt` and `sitemap.xml` are **server routes** (`server/routes/`), not
static files, because they have to differ per hostname: the app host
disallows everything, the docs host allows everything and points at a
sitemap built from `DEV_PORTAL_SLUGS`. A static `public/robots.txt` cannot
express that — it said `Disallow: /` for the whole site, which silently
blocked the portal too, since a disallowed URL is never fetched and so its
`index, follow` meta tag is never read.
## Platform billing (QuiroFlow charging clinics)

Separate from the Stripe Connect setup that charges a clinic's *patients* —
different account, different keys, on purpose, so a bug in one can never
reach the other's data. `stripeForPlatformBilling()` reads
`NUXT_STRIPE_PLATFORM_BILLING_SECRET_KEY`; `stripeForPlatform()` reads
`NUXT_STRIPE_SECRET_KEY`. Do not point them at the same account.

To stand it up in a new Stripe account:

1. `STRIPE_PLATFORM_BILLING_SECRET_KEY=sk_... node scripts/setup-platform-billing.mjs`
   creates the three plan products, the extra-practitioner product and their
   monthly/annual prices, then prints the SQL to point `plans` at them. It is
   idempotent — a second run reuses every price and creates nothing. Add
   `--dry-run` to see what it would do first.
2. Run the SQL it prints against the database.
3. Register the webhook: `https://app.quiroflow.com/api/stripe/platform-billing-webhook`,
   subscribed to `customer.subscription.created`, `.updated` and `.deleted`
   (nothing else — the endpoint deliberately ignores
   `checkout.session.completed`, see its own comment). Put the signing secret
   in `NUXT_STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET`.
4. Activate the Customer Portal (Stripe Dashboard → Settings → Billing →
   Customer portal). Without it, "Manage payment method & invoices" on
   `/subscription` returns an error rather than a portal link.

Plan limits are enforced in the database, not the app: `plans` carries
`included_professionals`, `included_whatsapp_conversations` and
`included_storage_gb`, and a trigger on `team_members` refuses a practitioner
past the seat allowance with SQLSTATE `PT402` (PostgREST turns that into a
402). Only practitioners consume a seat — admin staff are free and unlimited.
Comped accounts have no ceiling at all.

## Mobile app password autofill

The apps are Capacitor wrappers, so their WebView origin is
`capacitor://localhost` (iOS) / `https://localhost` (Android), not
`app.quiroflow.com`. Both platforms key saved passwords to a *domain*, so
without an explicit association neither offers the password the user already
saved on the website — autofill just silently does nothing in the app.

Two files on `app.quiroflow.com` declare that association, both served from
`public/.well-known/`:

- `apple-app-site-association` — `webcredentials` for
  `N5TP24Q7MW.com.quiroflow.app`, paired with the
  `com.apple.developer.associated-domains` entitlement in
  `mobile/ios/App/App/App.entitlements`. It has no file extension, so
  `netlify.toml` forces `Content-Type: application/json` on it; iOS rejects
  it as any other type. Signing is Automatic, so Xcode normally adds the
  Associated Domains capability to the App ID itself — if a build fails to
  sign, enable it for `com.quiroflow.app` in the Apple Developer portal.
- `assetlinks.json` — `delegate_permission/common.get_login_creds` for
  `com.quiroflow.app`.

Neither declares `applinks` / `common.handle_all_urls`: those route
`https://app.quiroflow.com` links into the app, which is a separate decision
from autofill.

`assetlinks.json` lists **two** fingerprints, and needs both. Play App
Signing re-signs every upload with Google's own key, so the certificate that
reaches users is not the one the AAB was built with:

- `2D:41:CD:…:66:8A` — the **app signing key** Google re-signs with. This is
  the one real installs present, so autofill matches on this. From Play
  Console → Protegida con Play → App signing → "App signing key certificate".
- `2B:9C:CB:…:BE:38` — the **upload key**
  (`mobile/android/quiroflow-upload.keystore`), kept so directly-signed
  builds (a locally built APK on a test device) match too.

Both live under the QuiroFlow developer account on **hola@columnaquiro.com**
(account ID 8114479705581398263) — not the personal Google account, which
has an unrelated, terminated developer profile on it.

Verify either file is reachable with no redirect (both platforms require
that):

```bash
curl -sI https://app.quiroflow.com/.well-known/assetlinks.json
```

## Clinic onboarding checklist

Once signed up (`/signup` creates the account + first clinic), everything
below is configured from the app itself — no redeploy needed:

- **Team & clinics** — Settings → Team Members / Clinics.
- **Appointment types** — Settings → Appointment Types (tag each with a
  `stage` — first visit, revision, maintenance, etc. — for the Statistics
  report to work).
- **WhatsApp** (optional) — Settings → WhatsApp: phone number ID, business
  account ID, access token from Meta. For delivery-status/reply tracking,
  register `https://app.quiroflow.com/api/whatsapp/webhook` as the
  account's webhook in Meta's App dashboard (only one webhook URL is
  allowed per WhatsApp number — the Settings page explains how to share
  that slot with an existing tool like n8n if it's already taken).
- **Payments/Stripe** (optional) — Settings → Payments: click "Connect with
  Stripe" and authorize via OAuth (Standard Connect) — no keys to copy.
  Requires the platform-level env vars documented in `.env.example`
  (`NUXT_STRIPE_SECRET_KEY`, `NUXT_PUBLIC_STRIPE_CONNECT_CLIENT_ID`,
  `NUXT_STRIPE_CONNECT_WEBHOOK_SECRET`), which need Connect enabled once on
  ColumnaQuiro's own Stripe account (Dashboard → Connect). Without those set,
  the page falls back to the legacy manual flow: paste a publishable + secret
  key from the clinic's own Stripe account, then register
  `https://app.quiroflow.com/api/stripe/webhook/<accountId>` as a webhook
  endpoint in the Stripe Dashboard (Developers → Webhooks) listening for
  `invoice.paid`, `invoice.payment_failed`, `subscription_schedule.updated`,
  `subscription_schedule.released`, `subscription_schedule.canceled`, and
  paste the signing secret back into the Settings page.
- **Packages/Memberships** — Settings → Packages / Memberships: define
  session-bundle and recurring-plan templates before selling one from a
  patient's Billing tab.
- **Migrating from PracticeHub** (optional) — Settings → Import Data →
  PracticeHub: Patients and Appointments need a CSV export; Payments,
  Patient Logs, Treatment Notes, Care Plans, and Custom Form Responses pull
  directly from PracticeHub's REST API (generate a key under PracticeHub →
  Developers → API Keys) — no CSV needed for those, and re-running any
  importer is safe, already-imported records are skipped.

## Status

Built out well past the original MVP scope — see the section above for
what's live. Not yet done: Care Plans/Treatment Notes import from
PracticeHub for clinics with a heavier history in those (only tested
against a small data set so far).
