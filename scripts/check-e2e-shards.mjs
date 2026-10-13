#!/usr/bin/env node
// Fails if any spec under cypress/e2e would not run in exactly one CI shard.
//
// The hole this exists for: a spec CI never runs is silent. It exists, it
// passes locally, every job stays green, and it never executes. That is what
// happened to cypress/e2e/growth -- two spec files merged before anyone
// noticed CI had never run either -- back when the shards were folder globs
// written into e2e.yml by hand and a new folder matched none of them.
//
// The shards are now computed by scripts/e2e-shard.mjs from the files on
// disk, so a new spec or folder is assigned by construction. What is left to
// prove is that it stays that way:
//
//   - the plan covers every spec on disk exactly once, at the shard count
//     the workflow actually runs;
//   - e2e.yml really runs the splitter, rather than having drifted back to
//     hand-written globs that nothing here would check;
//   - no shard is empty, which would mean a runner set up Supabase to run
//     nothing.
//
// Runs as part of `npm run preflight`, so it fires locally and in the
// typecheck job.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planShards, readTimings, root, specsOnDisk } from './e2e-shard.mjs'

const workflow = readFileSync(join(root, '.github/workflows/e2e.yml'), 'utf8')
const fail = (lines) => {
  for (const line of lines) console.error(line)
  process.exit(1)
}

const matrix = workflow.match(/^\s*shard:\s*\[([\d,\s]+)\]/m)
if (!matrix) {
  fail([
    'check-e2e-shards: found no `shard: [1, 2, ...]` matrix in .github/workflows/e2e.yml.',
    'The matrix format must have changed -- update this script to match.',
  ])
}
const shardNumbers = matrix[1].split(',').map((n) => Number(n.trim()))
const total = shardNumbers.length
if (shardNumbers.some((n, i) => n !== i + 1)) {
  fail([`check-e2e-shards: the shard matrix must be 1..${total} in order, found [${shardNumbers.join(', ')}].`])
}
if (!/node scripts\/e2e-shard\.mjs \$\{\{ matrix\.shard \}\} \$\{\{ strategy\.job-total \}\}/.test(workflow)) {
  fail([
    'check-e2e-shards: e2e.yml no longer picks each shard\'s specs with',
    '`node scripts/e2e-shard.mjs ${{ matrix.shard }} ${{ strategy.job-total }}`,',
    'so nothing proves every spec still runs. Restore that, or update this script.',
  ])
}

const specs = specsOnDisk()
const shards = planShards(specs, readTimings(), total)

const seen = new Map()
for (const spec of shards.flatMap((s) => s.specs)) seen.set(spec, (seen.get(spec) ?? 0) + 1)
const uncovered = specs.filter((spec) => !seen.has(spec))
const duplicated = [...seen].filter(([, n]) => n > 1).map(([spec]) => spec)
const empty = shards.map((s, i) => (s.specs.length === 0 ? i + 1 : null)).filter(Boolean)

const problems = []
if (uncovered.length) problems.push(`${uncovered.length} spec(s) run in no shard:`, ...uncovered.map((s) => `  ${s}`))
if (duplicated.length) problems.push(`${duplicated.length} spec(s) run in more than one shard:`, ...duplicated.map((s) => `  ${s}`))
if (empty.length) problems.push(`shard(s) ${empty.join(', ')} would run no spec -- fewer shards, or more specs.`)
if (problems.length) fail(['check-e2e-shards:', ...problems])

const slowest = Math.max(...shards.map((s) => s.seconds))
const fastest = Math.min(...shards.map((s) => s.seconds))
console.log(
  `${specs.length} e2e specs, each in exactly one of ${total} CI shards (~${Math.round(fastest)}-${Math.round(slowest)}s each).`,
)
