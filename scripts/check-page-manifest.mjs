#!/usr/bin/env node
// Fails if a page is missing from the client build manifest. Run after a build.
//
// The server decides what to modulepreload by looking each rendered
// component's source path up in .nuxt/dist/server/client.manifest.mjs. A page
// with no key there gets a modulepreload for the entry alone, and its own code
// is fetched only once the entry has run -- a round trip on every full load,
// with nothing failing and nothing on screen to say so. A lazily loaded child
// sharing modules with its page is what takes the key away (see
// pageChunkFacade in nuxt.config.ts); the booking page (#978) and the patient
// record both shipped like that.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestFile = join(root, '.nuxt/dist/server/client.manifest.mjs')
if (!existsSync(manifestFile)) {
  console.error(`No client manifest at ${relative(root, manifestFile)}: run the build first.`)
  process.exit(1)
}
const { default: manifest } = await import(pathToFileURL(manifestFile).href)

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.vue') ? [relative(root, full)] : []
  })
}

const pages = walk(join(root, 'pages'))
const missing = pages.filter((page) => !manifest[page])
if (missing.length) {
  console.error(`${missing.length} page(s) have no key in the client manifest, so the server cannot preload their code:`)
  for (const page of missing) console.error(`  ${page}`)
  process.exit(1)
}
console.log(`All ${pages.length} pages are in the client manifest.`)
