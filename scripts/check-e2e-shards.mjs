#!/usr/bin/env node
// Fails if any folder under cypress/e2e is not covered by a shard in
// .github/workflows/e2e.yml.
//
// The shard matrix lists folder globs explicitly, and nothing cross-checks
// them against what is actually on disk. Adding a new folder of specs is
// therefore silent: the specs exist, they pass locally, every CI job stays
// green, and not one of them ever runs. That is exactly what happened to
// cypress/e2e/growth -- two spec files merged before anyone noticed CI had
// never executed either.
//
// The workflow already explains why shards are folder globs rather than file
// globs: a spec added to an existing folder is then picked up automatically.
// This closes the remaining hole, which is a folder that belongs to no shard
// at all. Runs as part of `npm run preflight`, so it fires locally and in the
// typecheck job, next to check-migration-versions.mjs for the same reasons.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = join(root, '.github/workflows/e2e.yml')
const e2eDir = join(root, 'cypress/e2e')

const yaml = readFileSync(workflow, 'utf8')

// Every `specs: "a,b"` line in the matrix, flattened to the folder names the
// globs name. Deliberately a regex rather than a YAML parser: this needs no
// dependency, and the shape it depends on (a quoted comma-separated list of
// cypress/e2e/<folder>/** globs) is the shape the workflow documents.
const sharded = new Set()
for (const [, list] of yaml.matchAll(/^\s*specs:\s*"([^"]+)"/gm)) {
  for (const glob of list.split(',')) {
    const match = glob.trim().match(/^cypress\/e2e\/([^/*]+)\/\*\*$/)
    if (match) sharded.add(match[1])
  }
}

if (sharded.size === 0) {
  console.error('check-e2e-shards: found no spec globs in .github/workflows/e2e.yml.')
  console.error('The matrix format must have changed -- update this script to match.')
  process.exit(1)
}

const onDisk = readdirSync(e2eDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const unsharded = onDisk.filter((folder) => !sharded.has(folder))
const missing = [...sharded].filter((folder) => !onDisk.includes(folder))

if (unsharded.length > 0) {
  console.error(`check-e2e-shards: ${unsharded.length} spec folder(s) run in no CI shard:`)
  for (const folder of unsharded) console.error(`  cypress/e2e/${folder}`)
  console.error('')
  console.error('Add them to the `shard` matrix in .github/workflows/e2e.yml -- either')
  console.error('onto an existing shard or as a new one. Specs in an unsharded folder')
  console.error('pass locally and never run in CI.')
  process.exit(1)
}

if (missing.length > 0) {
  console.error(`check-e2e-shards: ${missing.length} shard glob(s) match no folder:`)
  for (const folder of missing) console.error(`  cypress/e2e/${folder}`)
  console.error('')
  console.error('A renamed or deleted folder leaves a shard running nothing.')
  process.exit(1)
}

console.log(`${onDisk.length} e2e spec folders, all covered by a CI shard.`)
