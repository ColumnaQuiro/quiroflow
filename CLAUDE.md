# Working on QuiroFlow

## Git workflow — always branch + PR, never push straight to `main`

`main` deploys continuously to production (**https://app.quiroflow.com** via
Netlify) on every push — see README "Production". A direct push to `main`
ships untested code to real clinics with no review and no CI gate. Because
of that:

- **Never commit or push directly to `main`.** Always create a new branch
  (from the latest `main`) for any change, however small.
- **Open a pull request** for every change and let CI run on it. CI
  (`.github/workflows/e2e.yml`) runs a `typecheck` job and three sharded
  `cypress` e2e jobs.
- **Only merge once CI is green.** Don't merge a PR with a failing or
  still-running check, and don't skip/disable a failing test to force it
  green — fix the real cause.
- Before opening a PR, run `npm run preflight` (typecheck) locally so CI
  isn't the first place a type error shows up.
- Merges are manual (no auto-merge configured) — CI green is a
  precondition for merging, not a signal to merge automatically.
- This applies the same way whether the change was requested by a person
  or is something an agent decided to do on its own initiative.

This is a convention, not a server-enforced rule — `main` doesn't currently
have branch protection configured on GitHub. If asked to help harden this
further, enabling "Require a pull request before merging" and "Require
status checks to pass" on `main` in the repo's branch protection settings
is the real enforcement mechanism; this file is what keeps agents honest
in the meantime.
