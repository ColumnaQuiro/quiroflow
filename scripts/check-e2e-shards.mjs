#!/usr/bin/env node
// Fails if any spec under cypress/e2e is not run by a shard in
// .github/workflows/e2e.yml, or is run by more than one.
//
// The shard matrix lists globs, and nothing cross-checks them against what is
// actually on disk. Adding a spec CI never runs is therefore silent: it
// exists, it passes locally, every job stays green, and it never executes.
// That is exactly what happened to cypress/e2e/growth -- two spec files
// merged before anyone noticed CI had never run either.
//
// This used to compare FOLDERS, which was enough while every shard was a
// `cypress/e2e/<folder>/**` glob. Growth outgrew that: at 237s it was the
// entire critical path of the run, and splitting it means naming specs, not
// folders. So the check now works at file level -- it expands each shard's
// globs and compares against every .cy.ts on disk.
//
// Two rules, and the second is new:
//
//   - every spec is covered by at least one shard. An uncovered spec never
//     runs, which is the original hole.
//   - no spec is covered by two. A spec matched twice runs twice, which is
//     silent wasted minutes on the very thing this file exists to keep short.
//
// Folder globs still work and are still the right default: a spec added to a
// folder-globbed shard is picked up with no workflow edit. A folder split
// across shards by file glob trades that away deliberately -- a new spec
// there fails this check until someone assigns it, which is the safe way to
// be told. Runs as part of `npm run preflight`, so it fires locally and in
// the typecheck job.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = join(root, '.github/workflows/e2e.yml')
const e2eDir = join(root, 'cypress/e2e')

/** Every `specs: "a,b"` in the matrix, as a flat list of globs. */
function shardGlobs() {
  const yaml = readFileSync(workflow, 'utf8')
  const globs = []
  for (const [, list] of yaml.matchAll(/^\s*specs:\s*"([^"]+)"/gm)) {
    for (const glob of list.split(',')) globs.push(glob.trim())
  }
  return globs
}

/** Every spec file, as a repo-relative path with forward slashes. */
function specsOnDisk(dir = e2eDir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...specsOnDisk(full))
    else if (entry.name.endsWith('.cy.ts')) out.push(relative(root, full).split('\\').join('/'))
  }
  return out
}

// Only the constructs the matrix uses: `**` for any depth, `*` for any run of
// characters inside one path segment, and a character class `[a-o]` or its
// negation `[!a-o]` for one character (which is how patients is split in two).
// Deliberately not a glob library -- this needs no dependency, and the
// workflow documents the shape it takes.
function globToRegExp(glob) {
  const classes = []
  const withoutClasses = glob.replace(/\[(!?)([^\]]+)\]/g, (_, negated, body) => {
    classes.push(negated ? `[^/${body}]` : `[${body}]`)
    return `\u0001${classes.length - 1}\u0001`
  })
  const escaped = withoutClasses.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\u0001(\d+)\u0001/g, (_, i) => classes[Number(i)])
  return new RegExp(`^${pattern}$`)
}

const globs = shardGlobs()
if (globs.length === 0) {
  console.error('check-e2e-shards: found no spec globs in .github/workflows/e2e.yml.')
  console.error('The matrix format must have changed -- update this script to match.')
  process.exit(1)
}

const specs = specsOnDisk()
const matchers = globs.map((glob) => ({ glob, re: globToRegExp(glob) }))

const uncovered = []
const duplicated = []
for (const spec of specs) {
  const hits = matchers.filter((m) => m.re.test(spec))
  if (hits.length === 0) uncovered.push(spec)
  else if (hits.length > 1) duplicated.push({ spec, globs: hits.map((h) => h.glob) })
}

const emptyGlobs = matchers.filter((m) => !specs.some((spec) => m.re.test(spec))).map((m) => m.glob)

let failed = false

if (uncovered.length > 0) {
  failed = true
  console.error(`check-e2e-shards: ${uncovered.length} spec(s) run in no CI shard:`)
  for (const spec of uncovered) console.error(`  ${spec}`)
  console.error('')
  console.error('Add them to the `shard` matrix in .github/workflows/e2e.yml -- either')
  console.error('onto an existing shard or as a new one. An unsharded spec passes')
  console.error('locally and never runs in CI.')
}

if (duplicated.length > 0) {
  failed = true
  console.error(`check-e2e-shards: ${duplicated.length} spec(s) run in more than one shard:`)
  for (const { spec, globs: hits } of duplicated) console.error(`  ${spec}  <- ${hits.join(' + ')}`)
  console.error('')
  console.error('Each one runs twice, on two runners, for no extra coverage.')
}

if (emptyGlobs.length > 0) {
  failed = true
  console.error(`check-e2e-shards: ${emptyGlobs.length} shard glob(s) match no spec:`)
  for (const glob of emptyGlobs) console.error(`  ${glob}`)
  console.error('')
  console.error('A renamed or deleted spec leaves a shard running nothing.')
}

if (failed) process.exit(1)

console.log(`${specs.length} e2e specs, each covered by exactly one CI shard.`)
