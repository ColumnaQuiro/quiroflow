# Working on QuiroFlow

## Git workflow — always branch + PR, never push straight to `main`

`main` deploys continuously to production (**https://app.quiroflow.com** via
Netlify) on every push — see README "Production". A direct push to `main`
ships untested code to real clinics with no review and no CI gate. Because
of that:

- **Never commit or push directly to `main`.** Always create a new branch
  (from the latest `main`) for any change, however small.
- **Open a pull request** for every change and let CI run on it. CI
  (`.github/workflows/e2e.yml`) runs a `typecheck` job (which also builds)
  and five sharded `cypress` e2e jobs, and runs **on pull requests only** —
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
  `preflight` is `nuxi typecheck` and typechecking does not compile
  templates: it exits 0 on a tree that cannot build. That is how a stray
  `v-else` shipped — preflight clean, every route 500ing, and the only
  signal was three Cypress shards failing on pages unrelated to the
  change. `npm run build` names it outright in about a minute.
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

## Deploying — GitHub Actions, not Netlify's git integration

`main` still deploys to production on every push, but **Netlify's own
continuous deployment is not what does it any more**. Netlify gates
git-based CD for a private, organization-owned repo behind its Pro plan,
so `.github/workflows/deploy.yml` does the job instead: it builds with
`npm run build` and ships the result with `netlify-cli deploy --prod`.

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
