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
