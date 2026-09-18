# Working on QuiroFlow

## Git workflow — always branch + PR, never push straight to `main`

`main` is the trunk everything merges into, and a **published GitHub release**
is what ships it to production (**https://app.quiroflow.com** via Netlify).
A direct push to `main` puts unreviewed code in the next release with no CI
gate behind it. Because of that:

- **Never commit or push directly to `main`.** Always create a new branch
  (from the latest `main`) for any change, however small.
- **Open a pull request** for every change and let CI run on it. CI
  (`.github/workflows/e2e.yml`) runs a `typecheck` job (which also builds)
  and six sharded `cypress` e2e jobs, and runs **on pull requests only** —
  nothing re-checks the code after a merge, so the PR is the only gate
  there is.
- **Only merge once CI is green.** Don't merge a PR with a failing or
  still-running check, and don't skip/disable a failing test to force it
  green — fix the real cause.
- **Sync the branch with `main` before merging** if `main` has moved since
  CI last ran. GitHub tests the *simulated merge* of the PR into `main`, so
  a green check describes the merge as it looked then. If `main` has since
  advanced, that result no longer describes what the merge will actually
  produce, and nothing runs afterwards to catch it. Re-sync, let CI run
  again, then merge.
- Before opening a PR, run `npm run preflight` **and `npm run build`**
  locally so CI isn't the first place a problem shows up. Both, because
  the typecheck inside `preflight` does not compile templates: it exits 0
  on a tree that cannot build. That is how a stray
  `v-else` shipped — preflight clean, every route 500ing, and the only
  signal was three Cypress shards failing on pages unrelated to the
  change. `npm run build` names it outright in about a minute.
- **A new folder of e2e specs runs in no shard until the matrix names
  it.** The shard list in `e2e.yml` is a set of folder globs, so a spec
  added to an *existing* folder is picked up automatically — but a brand
  new folder belongs to nothing, and the specs inside it then pass
  locally while CI never executes one of them. Every job stays green,
  which is what makes it hard to spot: `cypress/e2e/growth` had two spec
  files merged before anyone noticed. `npm run check:e2e-shards` now
  fails on any folder no shard covers, and runs as part of `preflight`.
- Merges are manual (no auto-merge configured) — CI green is a
  precondition for merging, not a signal to merge automatically.
- This applies the same way whether the change was requested by a person
  or is something an agent decided to do on its own initiative.

All of the above is convention, and it cannot be server-enforced here.
Branch protection — "Require a pull request before merging", "Require
status checks to pass", "Require branches to be up to date" — is
**unavailable on this repository**: it needs GitHub Pro or a public repo,
and this repo is private under a Free-plan organization. The API says so
outright ("Upgrade to GitHub Pro or make this repository public"), so
don't spend time trying to enable it. This file is the only thing keeping
agents honest.

That missing "Require branches to be up to date" checkbox is exactly why
the sync-before-merge rule above has to be followed by hand. Measured over
the last 13 merges, 11 were up to date and 2 went in 2–3 commits stale;
neither broke anything, but nothing would have caught it if they had.

## Migrations — timestamped filenames, never the next free number

New migrations get a **timestamped** filename, which is what
`supabase migration new <name>` generates:

```
supabase/migrations/20260913104512_whatsapp_webhook_authentication.sql
```

Not `0175_…`. Hand-numbering is what the older files use, and it breaks as
soon as two branches are open at once: both read main, both see `0174` as the
next free number, and both take it. Git reports no conflict, because the
filenames differ, and GitHub calls the PR cleanly mergeable. The break only
appears when someone builds a database:

```
Applying migration 0174_bono_outstanding_from_practicehub.sql...
Applying migration 0174_whatsapp_webhook_authentication.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(0174) already exists.
```

`supabase db reset` never finishes, so every Cypress shard fails and no fresh
environment can be built at all. That happened between #201 and #202; the gaps
at `0126` and `0169` are older numbers claimed and then abandoned.

Two things keep it from happening again:

- **Timestamps can't collide.** They also sort after every existing
  four-digit file, so ordering is unaffected.
- **`npm run check:migrations`** fails on two files sharing a version, and on
  a filename that starts with no version at all. It runs as part of
  `npm run preflight`, so it fires locally and in CI. CI builds each PR from a
  merge commit against *current* main, which is what makes it catch a
  collision introduced by someone else's merge without needing a rebase first.

Existing hand-numbered migrations stay as they are — renaming an applied
migration changes its version and would re-run it.

## Deploying — a published release, via GitHub Actions

**Merging does not deploy.** `.github/workflows/deploy.yml` runs when a
GitHub release is **published**, builds with `npm run build`, and ships the
result with `netlify-cli deploy --prod`. Netlify's own git-based CD is not
what does it: that is gated behind its Pro plan for a private,
organization-owned repo.

It used to run on every push to `main`. It no longer does, because **a
production deploy costs 15 Netlify credits**, charged per deploy however
small the change. One deploy per merge spends that on every typo fix — three
merges on 13 Sep cost 45 credits between them and exhausted the allowance.
Once it is exhausted, deploys are refused with a bare
`JSONHTTPError: Forbidden` and no other explanation, which is the *same*
error the "Enforce deployment methods" setting produces — so check usage
before assuming a setting changed. Batching merges into deliberate releases
is what keeps that spend down.

**So `main` and production are different things now.** Whatever is merged is
not live until someone publishes a release, and that applies to a security
fix exactly as much as to a feature. Before concluding a merged fix is in
effect, check what production is actually running — the live deploy is
listed under the Netlify project, and its `published_at` tells you which
merge it predates.

The workflow checks out **the release's tag**, not `main`, so a release
ships the commit it names rather than anything merged since. A manual
`workflow_dispatch` run takes an optional `ref` to build, and defaults to a
draft (non-production) deploy unless `prod` is ticked — which is the safe
way to verify SSR and the API routes without publishing.

Two things about that setup cost hours to work out, and neither is
guessable from the code:

- **`netlify deploy --prod` is refused unless the site's "Enforce
  deployment methods" setting allows it.** Under Build & deploy settings,
  "Only Git-based production branches can deploy to the production
  context" blocks every CLI/API deploy from reaching production while
  leaving draft deploys working. It presents as a bare
  `JSONHTTPError: Forbidden` with no hint about the cause. If production
  deploys start failing while drafts succeed, check that box first.
- **`NETLIFY_AUTH_TOKEN` must be a repository secret, not an
  organization one.** Free-plan organizations don't expose org-level
  secrets to private repositories: the secret silently resolves to an
  empty string and the deploy fails with
  `Unauthorized: could not retrieve project`.

**A release does not apply migrations, and never has.** The workflow builds
and uploads; nothing runs `supabase db push`. So a migration can merge, pass
CI, ride a release into production and leave its columns missing while the
deploy still reports success. That shipped twice on 15 Sep — the second time
v1.9.0 went live with a Billing tab reading `payments.created_by` against a
table that had no such column, and every patient's ledger failed with
`42703: column "created_by" does not exist` until someone noticed.

`npm run check:migrations-applied` runs as the first step of the deploy and
fails it when the database is behind the code. It is a check, not a push: a
failed deploy leaves production as it was, an applied migration does not.

**Applying is no longer a human step.** `.github/workflows/migrate.yml` runs
`supabase db push` on every push to `main` that touches
`supabase/migrations/`, so the schema goes live when a PR merges and a release
later ships code onto a schema that is already there. The deploy check above
stays exactly where it is and should now never fire.

That is deliberately a separate workflow rather than a step inside the deploy.
Applying DDL as a side effect of shipping code would fail a deploy halfway
through; here a refused push touches nothing else, and production keeps
running the old code against the old schema. It also fixes a problem the
manual route had: applying through an MCP tool stamps that tool's OWN
timestamp into `schema_migrations`, which is the drift described below and had
to be hand-corrected every time. `supabase db push` records the repo's
version.

It needs three **repository** secrets — `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`. Repository, not organization:
a Free-plan org does not expose org secrets to a private repo, and the secret
silently resolves to an empty string, which is the same trap
`NETLIFY_AUTH_TOKEN` fell into. The workflow checks all three are non-empty
before it does anything, so that failure names itself.

**The cost: between a merge and the next release, production runs the code
that is ALREADY LIVE against the new schema.** A migration that drops a
column, table or function the live code still calls breaks it in that window,
and `check:migrations-applied` cannot see it — the database is ahead, not
behind, which is the opposite of what it tests. So migrations must be
backwards-compatible with what is deployed, and
`npm run check:migration-compatibility` (part of `preflight`) fails a PR whose
new migration removes something still referenced under `components/`,
`pages/`, `server/`, `composables/`, `utils/`, `middleware/`, `plugins/` or
`mobile/`. Re-creating the name in the same migration is not a removal —
dropping `next_factura_number(uuid)` to replace it with a two-argument version
left every caller working. To proceed anyway, say why in the migration itself:

```sql
-- compat-ok: nothing has read this column since the importer was retired
```

That window is not new. It was previously as long as it took someone to
notice a failing deploy; automating the apply makes it short and predictable
rather than open-ended.

The check covers **timestamped migrations only**. The hand-numbered ones
(0001-0174) are recorded under generated versions with the number folded into
the name -- `0165_clinic_code_lookup` is version `20260911135143` -- and 29 are
not recorded at all, so comparing versions calls every one of them missing.
That is not a hole, because `npm run check:migrations` now **rejects any new
hand-numbered file**: everything added from here on is timestamped and
therefore checked. The two scripts hold each other up; weaken that rule and
migrations start escaping the applied-check silently.

Do not try to answer "is this migration applied?" by comparing the newest
version in `schema_migrations` against the repo. A migration applied out of
order sits BELOW that high-water mark and is invisible to the comparison —
which is exactly how `20260915100557` was missed after being looked for. The
version table had also drifted: nineteen migrations had been applied by a
tool that stamps its own timestamp, so the same migration sat in the repo as
`20260914171332_lead_marketing_consent` and in the database as
`20260915035219`. Each was verified present by its actual objects and
recorded at its repo version, so the two now line up. If the check reports
something you are sure is applied, suspect that drift has restarted, and
confirm against the objects before recording anything by hand.

**Scheduling a cron is a manual step too, and it is easy to forget.** New
`*-cron.post.ts` endpoints are called by pg_cron jobs that are created by
hand against the production database -- `cron.schedule` needs the real URL
and `NUXT_CRON_SECRET`, which is why `0081_enable_pg_cron.sql` says the
schedule "is applied separately there". So an endpoint can be written,
reviewed, tested, merged and deployed while nothing ever calls it, and
nothing looks wrong: an endpoint nobody calls is indistinguishable from one
with nothing to do. `lead-sequence-cron` shipped on 14 Sep and had still
never run on the 16th -- every lead drip would have started, sent its first
message, parked at the first delay and stayed there. It went unnoticed for
two days only because a separate bug cancelled every run before it reached a
delay; one failure hid another.

`npm run check:crons-scheduled` now runs in the deploy beside
`check:migrations-applied` and fails it when an endpoint has no active job.
To add one, clone an existing job so the URL and secret header stay
identical and only the path differs:

```sql
select cron.schedule(
  'lead-sequence-15min',
  '*/15 * * * *',
  (select replace(command, 'same-day-cron', 'lead-sequence-cron')
   from cron.job where jobname = 'appointment-same-day-15min')
);
```

That form also keeps the secret out of anything that reads the statement.
Job names are descriptive rather than derived (`same-day-cron` is scheduled
as `appointment-same-day-15min`), so the check matches on the endpoint path
inside the command, not on the name.

`--build` is deliberately not passed to the CLI. It would hand the build
to Netlify's own build system, and that system doesn't install
dependencies when driven this way from CI. Nitro's `netlify` preset
already emits everything Netlify needs from a plain `npm run build` —
`dist/` plus the `.netlify/functions-internal/server` function that serves
every SSR page and `/api/*` route — so building here and uploading the
result is both sufficient and simpler.

## Releasing the mobile app to the stores

The two store accounts are not where you would guess, and two of the build
steps fail on this machine without an environment override. Both cost a
round trip to work out, neither is discoverable from the code.

- **Google Play lives under `hola@columnaquiro.com`**, not the personal
  Google account. `raulcatalanluis@gmail.com` is signed in to Play Console
  too, but it only has the unrelated *Fidmi* developer account, so the
  console shows "choose a developer account" with no QuiroFlow in it and
  looks like a permissions problem. Switch accounts.
- **App Store Connect: Xcode Cloud owns the build number.**
  `CURRENT_PROJECT_VERSION` in project.pbxproj is not what reaches Apple --
  `ci_scripts/ci_post_clone.sh` overwrites it on every cloud build, and
  those builds have run on every push to `main` for a while (they were in
  the 60s while git still said 15). Only bump `MARKETING_VERSION` by hand,
  and only after a version is approved: see that script's comment for why
  a closed train silently rejects uploads by email rather than failing the
  build.
- **Both stores are Spain-only** as of 2026-09-13, deliberately -- more
  countries later. On Apple, "Make this app available in new territories"
  is still ticked and the API refuses to change it (`appAvailabilities`
  allows CREATE and GET only); the checkbox only appears inside the Manage
  Availability wizard's second step, which needs a pending country change
  to reach. Untick it next time you add a country there.
- **The Android release build needs JDK 21.** The default JDK here is 17
  and `capacitor-android` compiles at source level 21, so `./gradlew
  bundleRelease` dies with "invalid source release: 21". Run it as
  `JAVA_HOME=/usr/local/opt/openjdk@21 ./gradlew bundleRelease`. Signing
  picks itself up from `android/keystore.properties` (gitignored, with
  `quiroflow-upload.keystore` beside it).
- **`npx cap sync` fails at `pod install` without a UTF-8 locale.** It
  copies the web assets to both platforms first, so the failure looks
  worse than it is -- rerun just the pods with
  `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` in `mobile/ios/App`.
- **Uploading to App Store Connect from the CLI** works with
  `xcrun altool --upload-app -f App.ipa -t ios --apiKey J2TYK23YXQ
  --apiIssuer ac176fde-0772-4646-9e45-a7a2e4f65569`. The issuer is an
  account identifier, not a credential -- it is useless without the
  private key, which stays at
  `~/.appstoreconnect/private_keys/AuthKey_J2TYK23YXQ.p8` and must never
  be committed. Validate first with `--validate-app`; it catches the same
  problems minutes earlier than the upload does.
