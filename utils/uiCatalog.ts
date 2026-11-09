import { shallowReactive } from 'vue'
import type { UiLanguage } from './uiLanguage'

// Portuguese and German for an interface written as t('English', 'Español').
//
// English and Spanish sit at each call site; every other language is a
// catalog in i18n/, keyed by the English, which scripts/i18n-extract.mjs
// keeps in step with the code. A catalog has two halves:
//
//   s  plain strings     "Save" -> "Guardar"
//   p  patterns, for t(`Hello ${name}`, ...): the English with each ${...}
//      numbered. useT() receives the English already interpolated ("Hello
//      Ana"), so a string with no exact entry is matched back against the
//      patterns and the captured values are put into the translation:
//      "Hello {0}" -> "Olá {0}".
//
// A placeholder in a translation can also pick a word by what was captured,
// for the values that are English words themselves -- `${n === 1 ? 'visit'
// : 'visits'}`:
//
//      "{0} {1}" -> "{0} {1|visit=consulta|visits=consultas}"
//
// Such a placeholder only matches one of the words it lists, which is what
// keeps a pattern made of nothing but placeholders from matching any string
// at all. A placeholder in the translation that the English pattern does not
// have, or a pattern with neither a letter outside its placeholders nor a
// word list, is never used.
//
// Anything not in the catalog shows in English.

export type CatalogLanguage = Exclude<UiLanguage, 'en' | 'es'>
export const CATALOG_LANGUAGES: readonly CatalogLanguage[] = ['pt', 'de']

interface CatalogFile {
  s: Record<string, string>
  p: Record<string, string>
}

interface Pattern {
  re: RegExp
  // The placeholder each capture group holds, in order.
  order: number[]
  score: number
  parts: Array<string | { index: number; words?: Map<string, string> }>
}

interface Compiled {
  strings: Map<string, string>
  // Patterns by the first character of their English (or '' when it starts
  // with a placeholder), so a miss is tried against a handful, not all.
  byFirst: Map<string, Pattern[]>
  cache: Map<string, string>
}

const PLACEHOLDER = /\{(\d+)(?:\|([^{}]*))?\}/g
const CACHE_LIMIT = 4000

const catalogs = shallowReactive<Partial<Record<CatalogLanguage, Compiled>>>({})
const pending = new Map<CatalogLanguage, Promise<void>>()

const loaders: Record<CatalogLanguage, () => Promise<{ default: CatalogFile }>> = {
  pt: () => import('../i18n/pt.json') as unknown as Promise<{ default: CatalogFile }>,
  de: () => import('../i18n/de.json') as unknown as Promise<{ default: CatalogFile }>,
}

export function isCatalogLanguage(lang: string): lang is CatalogLanguage {
  return (CATALOG_LANGUAGES as readonly string[]).includes(lang)
}

export function isUiCatalogLoaded(lang: CatalogLanguage): boolean {
  return Boolean(catalogs[lang])
}

// Loads a language's catalog once; English and Spanish have none. Safe to
// call as often as wanted: a second call waits on the first.
export function loadUiCatalog(lang: UiLanguage): Promise<void> {
  if (!isCatalogLanguage(lang) || catalogs[lang]) return Promise.resolve()
  let p = pending.get(lang)
  if (!p) {
    p = loaders[lang]()
      .then((m) => {
        catalogs[lang] = compileCatalog(m.default)
      })
      .catch((error) => {
        // Not fatal: the interface stays in English. Forget the attempt so a
        // later call can retry (a chunk that failed on a flaky connection).
        pending.delete(lang)
        console.error(`[uiCatalog] could not load the ${lang} catalog`, error)
      })
    pending.set(lang, p)
  }
  return p
}

export function compileCatalog(file: CatalogFile): Compiled {
  const strings = new Map(Object.entries(file.s ?? {}))
  const byFirst = new Map<string, Pattern[]>()
  for (const [key, value] of Object.entries(file.p ?? {})) {
    const pattern = compilePattern(key, value)
    if (!pattern) continue
    const first = key.startsWith('{') ? '' : key[0]!
    const list = byFirst.get(first) ?? []
    list.push(pattern)
    byFirst.set(first, list)
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.score - a.score)
  return { strings, byFirst, cache: new Map() }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePattern(key: string, value: string): Pattern | null {
  const keyIndexes = new Set([...key.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])))
  const words = new Map<number, Map<string, string>>()
  const parts: Pattern['parts'] = []
  let last = 0
  for (const m of value.matchAll(PLACEHOLDER)) {
    const index = Number(m[1])
    if (!keyIndexes.has(index)) return null
    if (m.index! > last) parts.push(value.slice(last, m.index))
    let list: Map<string, string> | undefined
    if (m[2] !== undefined) {
      list = new Map()
      for (const pair of m[2].split('|')) {
        const eq = pair.indexOf('=')
        if (eq > 0) list.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
      const all = words.get(index) ?? new Map()
      for (const [k, v] of list) all.set(k, v)
      words.set(index, all)
    }
    parts.push({ index, words: list })
    last = m.index! + m[0].length
  }
  if (last < value.length) parts.push(value.slice(last))

  const literal = key.replace(/\{\d+\}/g, '')
  if (!/\p{L}/u.test(literal) && words.size === 0) return null

  let source = '^'
  let at = 0
  const order: number[] = []
  for (const m of key.matchAll(/\{(\d+)\}/g)) {
    source += escapeRe(key.slice(at, m.index))
    const index = Number(m[1])
    const list = words.get(index)
    source += list ? `(${[...list.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})` : '([\\s\\S]*?)'
    order.push(index)
    at = m.index! + m[0].length
  }
  source += escapeRe(key.slice(at)) + '$'
  return { re: new RegExp(source, 'u'), order, score: literal.length + words.size * 1000, parts }
}

function fill(pattern: Pattern, match: RegExpExecArray): string {
  const values = new Map<number, string>()
  pattern.order.forEach((index, i) => values.set(index, match[i + 1] ?? ''))
  return pattern.parts
    .map((part) => {
      if (typeof part === 'string') return part
      const captured = values.get(part.index) ?? ''
      return part.words?.get(captured) ?? captured
    })
    .join('')
}

export function translateWithCatalog(cat: Compiled, en: string): string {
  const exact = cat.strings.get(en)
  if (exact !== undefined) return exact
  const cached = cat.cache.get(en)
  if (cached !== undefined) return cached

  let out = en
  for (const list of [cat.byFirst.get(en[0] ?? ''), cat.byFirst.get('')]) {
    if (!list) continue
    let found = false
    for (const pattern of list) {
      const m = pattern.re.exec(en)
      if (m) {
        out = fill(pattern, m)
        found = true
        break
      }
    }
    if (found) break
  }
  if (cat.cache.size >= CACHE_LIMIT) cat.cache.clear()
  cat.cache.set(en, out)
  return out
}

// The text for `en` in a catalog language. While its catalog is still
// loading -- or if it never does -- the English.
export function uiCatalogTranslate(lang: CatalogLanguage, en: string): string {
  const cat = catalogs[lang]
  if (!cat) {
    void loadUiCatalog(lang)
    return en
  }
  return translateWithCatalog(cat, en)
}
