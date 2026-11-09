#!/usr/bin/env node
// Collects every t(en, es) call in the web and mobile app and keeps the
// Portuguese and German catalogs (i18n/pt.json, i18n/de.json) in step with
// them.
//
// The interface is written as t('English', 'Español') at each call site
// (composables/useT.ts). English and Spanish come straight from those two
// arguments; any other language is looked up in a catalog keyed by the
// English text. This script is what keeps that key list honest:
//
//   node scripts/i18n-extract.mjs            report what is missing (exit 1 if anything is)
//   node scripts/i18n-extract.mjs --write    also prune catalog entries nothing uses any more
//   node scripts/i18n-extract.mjs --todo out.json
//                                            write the missing strings, with their Spanish and
//                                            the files they come from, for translating
//
// Two kinds of key:
//
//   "s" -- a plain string: t('Save', 'Guardar') -> "Save"
//   "p" -- a template with interpolations: t(`Hello ${name}`, `Hola ${name}`)
//          -> "Hello {0}". At runtime the English string arrives already
//          interpolated ("Hello Ana"); useT matches it back against the
//          pattern and substitutes the captured values into the translation.
//          A pattern with no letters outside its placeholders ("{0} · {1}")
//          says nothing to translate and is skipped, unless its values are
//          English words themselves (`${n === 1 ? 'visit' : 'visits'}`).
//
// The lookup is by the English text, however it reaches t(), so the same
// goes for the bilingual data that is passed in as t(pair[0], pair[1]) or
// t(o.en, o.es): an ['English', 'Español'] pair and an { en, es } object are
// collected too.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
export const LANGS = ['pt', 'de']
const DIRS = [
  'components', 'pages', 'layouts', 'composables', 'utils', 'middleware', 'plugins', 'stores', 'app.vue',
  'mobile/components', 'mobile/pages', 'mobile/layouts', 'mobile/composables', 'mobile/plugins',
  'mobile/middleware', 'mobile/utils', 'mobile/app.vue',
]

// Not translated by catalog, on purpose:
//  - the legal pages, which read English or Spanish (a machine-translated
//    privacy policy is not one anybody signed off), and
//  - message content a clinic sends patients -- email and campaign bodies --
//    which is created in the clinic's own language, not shown through t().
const SKIP_FILES = [/^pages\/legal\//, /^utils\/legalSubprocessors\.ts$/]
const SKIP_OBJECT_PROPS = new Set(['body', 'subject', 'html'])

function walk(p, out) {
  const abs = path.join(ROOT, p)
  if (!fs.existsSync(abs)) return out
  const st = fs.statSync(abs)
  if (st.isFile()) {
    if (/\.(vue|ts|mts)$/.test(p) && !/\.(spec|test|d)\.ts$/.test(p) && !SKIP_FILES.some((re) => re.test(p))) out.push(p)
    return out
  }
  for (const name of fs.readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    walk(path.join(p, name), out)
  }
  return out
}

// The cooked text of a string or template argument, with each ${expr}
// replaced by {n}. `exprs` lists the expressions' source in order.
function argText(node, src) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, exprs: [] }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text
    const exprs = []
    node.templateSpans.forEach((span, i) => {
      exprs.push(span.expression.getText(src))
      text += `{${i}}` + span.literal.text
    })
    return { text, exprs }
  }
  return null
}

// A two-string array is a translation pair unless it looks like a pair of
// identifiers (['first_name', 'next_appointment'], ['en', 'es']).
const IDENT = /^[a-z0-9_.:/-]*$/
function looksLikePair(en, es) {
  if (!/\p{L}/u.test(en.text) || en.text === es.text) return false
  if (IDENT.test(en.text) && IDENT.test(es.text) && (/[_.:/-]/.test(en.text + es.text) || en.text.length <= 3)) return false
  return true
}

function collectFromCode(code, file, found, offsetLine = 0) {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const lineOf = (node) => src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 + offsetLine
  const visit = (node) => {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
      const en = argText(node.elements[0], src)
      const es = argText(node.elements[1], src)
      if (en && es && looksLikePair(en, es)) found.push({ en, es, file: `${file}:${lineOf(node)}` })
    }
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name) => node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(src) === name)
      const enProp = prop('en')
      const esProp = prop('es')
      const parent = node.parent
      // { es, en, fr } is the booking page's own three languages
      // (useBookingLang), read with say(), never t().
      const skipped = (parent && ts.isPropertyAssignment(parent) && SKIP_OBJECT_PROPS.has(parent.name.getText(src))) || prop('fr')
      // { label: 'Visits this week', labelEs: 'Visitas esta semana' }, and
      // the same with any name: foo + fooEs, or fooEn + fooEs.
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const name = p.name.getText(src)
        if (!/^\w+Es$/.test(name) || name === 'Es') continue
        const base = name.slice(0, -2)
        const enP = prop(base) ?? prop(`${base}En`)
        if (!enP) continue
        const en = argText(enP.initializer, src)
        const es = argText(p.initializer, src)
        if (en && es && /\p{L}/u.test(en.text)) found.push({ en, es, file: `${file}:${lineOf(node)}` })
      }
      // { name: 'Cash', es: 'Efectivo' }: a name or label beside its Spanish.
      const nameProp = !enProp && esProp ? prop('name') ?? prop('label') : null
      if (nameProp && !skipped) {
        const en = argText(nameProp.initializer, src)
        const es = argText(esProp.initializer, src)
        if (en && es && /\p{L}/u.test(en.text)) found.push({ en, es, file: `${file}:${lineOf(node)}` })
      }
      if (enProp && esProp && !skipped) {
        const en = argText(enProp.initializer, src)
        const es = argText(esProp.initializer, src)
        if (en && es && /\p{L}/u.test(en.text)) found.push({ en, es, file: `${file}:${lineOf(node)}` })
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length === 2) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
      if (name === 't') {
        const en = argText(node.arguments[0], src)
        const es = argText(node.arguments[1], src)
        if (en && es) {
          const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 + offsetLine
          found.push({ en, es, file: `${file}:${line}` })
        } else if (!en && !es) {
          // t(a, b) with computed arguments: nothing to extract.
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
}

function collectFromTemplate(node, file, found) {
  const exps = []
  const visit = (n) => {
    if (n.type === 5 /* INTERPOLATION */ && n.content?.content) exps.push([n.content.content, n.loc.start.line])
    if (n.type === 1 /* ELEMENT */) {
      for (const p of n.props ?? []) if (p.type === 7 /* DIRECTIVE */ && p.exp?.content) exps.push([p.exp.content, p.loc.start.line])
    }
    for (const c of n.children ?? []) visit(c)
    if (n.branches) for (const b of n.branches) visit(b)
  }
  visit(node)
  for (const [exp, line] of exps) collectFromCode(`(${exp}\n)`, file, found, line - 1)
}

export function extract() {
  const files = DIRS.flatMap((d) => walk(d, []))
  const found = []
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8')
    if (file.endsWith('.vue')) {
      const { descriptor } = parseSfc(code, { filename: file })
      for (const block of [descriptor.script, descriptor.scriptSetup]) {
        if (block) collectFromCode(block.content, file, found, block.loc.start.line - 1)
      }
      if (descriptor.template?.ast) collectFromTemplate(descriptor.template.ast, file, found)
    } else {
      collectFromCode(code, file, found)
    }
  }

  const strings = new Map() // key -> { es, files: Set, exprs }
  const patterns = new Map()
  for (const { en, es, file } of found) {
    const isPattern = en.exprs.length > 0
    const wordyValues = en.exprs.some((e) => /(['"`])[^'"`]*\p{L}{2}[^'"`]*\1/u.test(e))
    if (isPattern && !/\p{L}/u.test(en.text.replace(/\{\d+\}/g, '')) && !wordyValues) continue
    if (!isPattern && !/\p{L}/u.test(en.text)) continue
    // Spanish with its expressions numbered the way the English ones are,
    // so a translator sees which value is which.
    let esText = es.text
    es.exprs.forEach((e, i) => {
      const j = en.exprs.indexOf(e)
      esText = esText.replace(`{${i}}`, j >= 0 ? `{@${j}}` : `\${${e}}`)
    })
    esText = esText.replace(/\{@(\d+)\}/g, '{$1}')
    const map = isPattern ? patterns : strings
    const entry = map.get(en.text) ?? { es: esText, files: new Set(), exprs: en.exprs }
    entry.files.add(file)
    map.set(en.text, entry)
  }
  return { strings, patterns, calls: found.length }
}

export function catalogPath(lang) {
  return path.join(ROOT, 'i18n', `${lang}.json`)
}

export function readCatalog(lang) {
  try {
    return JSON.parse(fs.readFileSync(catalogPath(lang), 'utf8'))
  } catch {
    return { s: {}, p: {} }
  }
}

function sortObject(o) {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
}

export function writeCatalog(lang, cat) {
  fs.mkdirSync(path.dirname(catalogPath(lang)), { recursive: true })
  fs.writeFileSync(catalogPath(lang), JSON.stringify({ s: sortObject(cat.s), p: sortObject(cat.p) }, null, 1) + '\n')
}

// A translated pattern may only use the placeholders its English key has.
function badPlaceholders(key, value) {
  const want = new Set(key.match(/\{\d+\}/g) ?? [])
  const got = value.match(/\{\d+\}/g) ?? []
  return got.some((g) => !want.has(g))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const todoAt = args.indexOf('--todo')
  const { strings, patterns, calls } = extract()
  console.log(`${calls} t() calls -> ${strings.size} strings + ${patterns.size} patterns`)

  const todo = []
  let failed = false
  for (const lang of LANGS) {
    const cat = readCatalog(lang)
    const missing = []
    const broken = []
    for (const [kind, map] of [['s', strings], ['p', patterns]]) {
      for (const [key, entry] of map) {
        const value = cat[kind][key]
        if (typeof value !== 'string' || !value) missing.push({ kind, key, ...entry })
        else if (kind === 'p' && badPlaceholders(key, value)) broken.push(key)
      }
      const unused = Object.keys(cat[kind]).filter((k) => !map.has(k))
      if (write) for (const k of unused) delete cat[kind][k]
      else if (unused.length) console.log(`${lang}: ${unused.length} unused ${kind === 's' ? 'strings' : 'patterns'} (prune with --write)`)
    }
    if (write) writeCatalog(lang, cat)
    if (missing.length || broken.length) failed = true
    console.log(`${lang}: ${missing.length} missing, ${broken.length} with placeholders the English does not have`)
    for (const m of missing.slice(0, 15)) console.log(`  - ${JSON.stringify(m.key)}  (${[...m.files][0]})`)
    for (const b of broken.slice(0, 15)) console.log(`  ! ${JSON.stringify(b)}`)
    for (const m of missing) todo.push({ lang, kind: m.kind, en: m.key, es: m.es, exprs: m.exprs, file: [...m.files][0] })
  }
  if (todoAt >= 0) {
    // One row per string, with the languages it still needs.
    const merged = new Map()
    for (const t of todo) {
      const k = `${t.kind}\u0000${t.en}`
      const row = merged.get(k) ?? { kind: t.kind, en: t.en, es: t.es, exprs: t.exprs.length ? t.exprs : undefined, file: t.file, need: [] }
      row.need.push(t.lang)
      merged.set(k, row)
    }
    fs.writeFileSync(args[todoAt + 1], JSON.stringify([...merged.values()], null, 1))
    console.log(`wrote ${merged.size} rows to ${args[todoAt + 1]}`)
  }
  if (failed && !args.includes('--report-only')) {
    console.log('\nEvery t(en, es) needs Portuguese and German too: add them to i18n/pt.json and i18n/de.json.')
    process.exit(1)
  }
}
