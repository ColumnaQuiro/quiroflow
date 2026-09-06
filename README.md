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

**⚠️ After the first Play Store upload**, add a second fingerprint to
`assetlinks.json`. The one committed is the *upload* key
(`mobile/android/quiroflow-upload.keystore`). Play App Signing re-signs the
app with Google's own key, so what ships to users has a different
fingerprint and autofill won't match until it's listed. Copy it from Play
Console → Setup → App signing → "App signing key certificate" (SHA-256) and
append it to `sha256_cert_fingerprints` — the field is an array precisely so
both keys can be listed, and keeping the upload key covers directly-signed
builds.

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
