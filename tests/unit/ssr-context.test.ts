import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Route middleware and plugins must resolve every composable before their
// first await. On the server an await drops Vue's injection context -- Nuxt's
// transform restores only its own app context -- so a Pinia store resolved
// after one cannot inject this request's Pinia and falls back to the
// module-global "active" one, which is whichever request set it last. Under
// concurrent SSR that handed one clinic's request another clinic's account
// store (and, when the other request had finished, a 500: "getActivePinia()
// was called but there was no active Pinia"). See middleware/account.global.ts.
//
// Only Pinia actually breaks; useSupabaseClient() and friends survive an
// await in the middleware body itself. The rule is "no use*() after an await"
// anyway, because it is one rule nobody has to remember the exceptions to.

const ROOT = join(__dirname, '..', '..')
// Client-only plugins run in the browser, where there is one app and one
// Pinia, so they are out of scope. mobile/ is a client-only build too, but
// shares the middleware idiom, so it is held to the same rule.
const DIRS = ['middleware', 'plugins', 'mobile/middleware', 'mobile/plugins']

function sourceFiles() {
  return DIRS.flatMap((dir) => {
    let names: string[]
    try {
      names = readdirSync(join(ROOT, dir))
    } catch {
      return []
    }
    return names
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.client.ts'))
      .map((n) => join(dir, n))
  })
}

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Composable calls (`useFoo(`) that appear after the first `await`. */
function composablesAfterFirstAwait(src: string): string[] {
  const code = stripComments(src)
  const first = code.search(/\bawait\b/)
  if (first === -1) return []
  return [...code.slice(first).matchAll(/\buse[A-Z]\w*(?=\s*\()/g)].map((m) => m[0])
}

describe('composables before the first await in middleware and plugins', () => {
  it('flags a store resolved after an await', () => {
    const bad = `export default defineNuxtRouteMiddleware(async () => {
      const ok = await useTwoFactor().gate()
      const store = useAccountStore()
    })`
    expect(composablesAfterFirstAwait(bad)).toEqual(['useTwoFactor', 'useAccountStore'])
  })

  it('ignores composables named in comments', () => {
    const fine = `export default defineNuxtRouteMiddleware(async () => {
      const store = useAccountStore()
      await store.load()
      // useAccountStore() is resolved above
      /* useSupabaseClient() too */
    })`
    expect(composablesAfterFirstAwait(fine)).toEqual([])
  })

  const files = sourceFiles()

  it('scans the account middleware', () => {
    expect(files).toContain(join('middleware', 'account.global.ts'))
  })

  it.each(files)('%s', (file) => {
    expect(composablesAfterFirstAwait(readFileSync(join(ROOT, file), 'utf8'))).toEqual([])
  })
})
