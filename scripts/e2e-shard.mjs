#!/usr/bin/env node
// Splits the e2e specs across CI's Cypress shards by measured time.
//
//   node scripts/e2e-shard.mjs <shard> <total>   the specs for one shard, as
//                                                 the comma list `cypress run
//                                                 --spec` takes
//   node scripts/e2e-shard.mjs --plan <total>     every shard, with its specs
//                                                 and estimated seconds
//
// The shards used to be folder globs written into e2e.yml by hand, rebalanced
// from a timing table whenever one shard grew into the critical path. That
// happened at least five times, and the table was stale every time someone
// needed it: on 2026-10-13 settings ran for 383s while three shards were done
// in under 110s, and the run waited on settings.
//
// Here every spec on disk is assigned, longest first, to whichever shard has
// the least estimated time so far (LPT scheduling). Estimates come from
// cypress/e2e-timings.json, which `npm run e2e:timings -- <run-id>` rebuilds
// from a CI run's logs. A spec with no timing yet -- a new one -- is costed at
// the median, so it lands somewhere and still runs. Stale timings only make
// the shards less even; they can never leave a spec out.
//
// The result depends only on the files in the checkout, so every shard of a
// run computes the same plan and between them they cover each spec exactly
// once. check-e2e-shards.mjs proves that in preflight.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const e2eDir = join(root, 'cypress/e2e')
const timingsFile = join(root, 'cypress/e2e-timings.json')

/** Every spec file, as a repo-relative path with forward slashes, sorted. */
export function specsOnDisk(dir = e2eDir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...specsOnDisk(full))
    else if (entry.name.endsWith('.cy.ts')) out.push(relative(root, full).split('\\').join('/'))
  }
  return out.sort()
}

/** Seconds per spec path, as last measured in CI. */
export function readTimings() {
  return JSON.parse(readFileSync(timingsFile, 'utf8'))
}

function median(values) {
  if (values.length === 0) return 10
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** `total` shards of `{ specs, seconds }`, covering every spec exactly once. */
export function planShards(specs, timings, total) {
  const fallback = median(specs.map((spec) => timings[spec]).filter((s) => typeof s === 'number'))
  const costed = specs
    .map((spec) => ({ spec, seconds: timings[spec] ?? fallback }))
    // Ties broken by name, so the plan never depends on readdir order.
    .sort((a, b) => b.seconds - a.seconds || a.spec.localeCompare(b.spec))
  const shards = Array.from({ length: total }, () => ({ specs: [], seconds: 0 }))
  for (const { spec, seconds } of costed) {
    const lightest = shards.reduce((best, shard) => (shard.seconds < best.seconds ? shard : best))
    lightest.specs.push(spec)
    lightest.seconds += seconds
  }
  for (const shard of shards) shard.specs.sort()
  return shards
}

function main(args) {
  if (args[0] === '--plan') {
    const total = Number(args[1])
    if (!Number.isInteger(total) || total < 1) usage()
    const shards = planShards(specsOnDisk(), readTimings(), total)
    shards.forEach((shard, i) => {
      console.log(`shard ${i + 1}: ~${Math.round(shard.seconds)}s, ${shard.specs.length} specs`)
      for (const spec of shard.specs) console.log(`  ${spec}`)
    })
    return
  }
  const shard = Number(args[0])
  const total = Number(args[1])
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) usage()
  const plan = planShards(specsOnDisk(), readTimings(), total)[shard - 1]
  console.error(`shard ${shard} of ${total}: ${plan.specs.length} specs, ~${Math.round(plan.seconds)}s estimated`)
  console.log(plan.specs.join(','))
}

function usage() {
  console.error('usage: e2e-shard.mjs <shard> <total>   |   e2e-shard.mjs --plan <total>')
  process.exit(2)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
