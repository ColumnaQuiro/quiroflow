#!/usr/bin/env node
// Rebuilds cypress/e2e-timings.json, which e2e-shard.mjs balances the CI
// shards on, from the logs of real CI runs.
//
//   npm run e2e:timings                    the last 3 successful CI runs
//   npm run e2e:timings -- <run-id> ...    those runs
//
// Each spec's time is wall-clock from its "Running:" line to the next one, so
// it includes Cypress's per-spec bundling and browser reset and any retries --
// what the spec actually costs a shard, not the "Duration" column, which
// leaves all of that out. Specs seen in several runs are averaged; specs not
// seen keep the time they had; specs no longer on disk are dropped.
//
// Needs the `gh` CLI, signed in to an account that can read this repo.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, specsOnDisk } from './e2e-shard.mjs'

const timingsFile = join(root, 'cypress/e2e-timings.json')

function gh(...args) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function seconds(line) {
  const m = line.match(/T(\d\d):(\d\d):(\d\d(?:\.\d+)?)Z/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

let runIds = process.argv.slice(2)
if (runIds.length === 0) {
  runIds = JSON.parse(
    gh('run', 'list', '--workflow', 'e2e.yml', '--status', 'success', '--limit', '3', '--json', 'databaseId'),
  ).map((r) => String(r.databaseId))
}

const specs = specsOnDisk()
// Cypress prints each spec relative to the deepest folder the shard's specs
// share -- `settings/team.cy.ts` in a mixed shard, `team.cy.ts` in one that
// happens to be all settings -- so match on the path's tail.
function resolve(printed) {
  const hits = specs.filter((s) => s === `cypress/e2e/${printed}` || s.endsWith(`/${printed}`))
  return hits.length === 1 ? hits[0] : null
}

const samples = {}
const unresolved = new Set()
for (const runId of runIds) {
  const jobs = JSON.parse(gh('api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`)).jobs
  const shards = jobs.filter((j) => j.name.startsWith('cypress'))
  console.error(`run ${runId}: ${shards.length} cypress jobs`)
  for (const job of shards) {
    // eslint-disable-next-line no-control-regex -- strips the ANSI colour codes the job log carries
    const log = gh('api', `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`).replace(/\x1b\[[0-9;]*m/g, '')
    const events = []
    for (const line of log.split('\n')) {
      const running = line.match(/Running:\s+(\S+\.cy\.ts)/)
      if (running) events.push({ printed: running[1], at: seconds(line) })
      else if (line.includes('(Run Finished)')) {
        events.push({ printed: null, at: seconds(line) })
        break
      }
    }
    for (let i = 0; i + 1 < events.length; i++) {
      const spec = resolve(events[i].printed)
      if (!spec) {
        unresolved.add(events[i].printed)
        continue
      }
      let took = events[i + 1].at - events[i].at
      if (took < 0) took += 24 * 3600 // crossed midnight UTC
      ;(samples[spec] ??= []).push(took)
    }
  }
}

const previous = JSON.parse(readFileSync(timingsFile, 'utf8'))
const next = {}
for (const spec of specs) {
  const seen = samples[spec]
  if (seen) next[spec] = Math.max(1, Math.round(seen.reduce((a, b) => a + b, 0) / seen.length))
  else if (spec in previous) next[spec] = previous[spec]
}
writeFileSync(timingsFile, `${JSON.stringify(next, null, 2)}\n`)

const measured = Object.keys(samples).length
const missing = specs.filter((s) => !(s in next))
console.error(`${measured} specs measured, ${Object.keys(next).length} of ${specs.length} now have a time.`)
if (missing.length) console.error(`No time yet (costed at the median): ${missing.join(', ')}`)
if (unresolved.size) console.error(`Could not match to a file on disk: ${[...unresolved].join(', ')}`)
