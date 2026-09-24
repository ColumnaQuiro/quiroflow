#!/usr/bin/env node
// Fails if a Growth screen hardcodes a colour instead of using a theme token.
//
// Every Growth screen was built from a Claude Design handoff whose artboards
// specify colours as literal hexes -- #4F46E5, #E8E9ED, #F7F8FA and so on.
// Pasting those across works perfectly in light mode and breaks completely in
// dark, because the dark palette is a different set of values behind the same
// token names. That is the single easiest mistake to make on these screens
// and the hardest to notice, since nobody reviews in dark by default.
//
// Today there are zero hardcoded colours under growth/, which is the only
// reason the dark theme needed no dark-specific CSS at all. This keeps it
// that way.
//
// Scoped to growth/ and the calendar deliberately. The rest of the app
// predates the token system and has legitimate exceptions -- pages/inbox.vue
// paints WhatsApp's own brand green, which is a fixed brand colour and
// correctly not a token. Widen this only alongside the work to clean those up,
// as the calendar redesign did: its type and team colours come from data and
// are tinted with color-mix() against a surface token, never a literal.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['components/growth', 'pages/growth', 'components/calendar', 'pages/calendar.vue', 'pages/account.vue', 'components/ui/ConfirmDialog.vue']

// Hex colours, and the rgb()/hsl() forms that dodge a hex check. A CSS var
// reference is what we WANT, so rgb(var(--x)) has to survive.
const HEX = /#[0-9A-Fa-f]{3,8}\b/g
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\(\s*(?!var\()/g

function walk(dir) {
  const out = []
  if (/\.(vue|ts)$/.test(dir)) return [dir]
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

const offences = []
for (const dir of ROOTS) {
  const abs = join(root, dir)
  try {
    statSync(abs)
  } catch {
    continue
  }
  for (const file of walk(abs)) {
    const text = readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const re of [HEX, FUNC]) {
        re.lastIndex = 0
        const match = re.exec(line)
        if (match) offences.push({ file: relative(root, file), line: i + 1, snippet: match[0], text: line.trim().slice(0, 90) })
      }
    })
  }
}

if (offences.length > 0) {
  console.error(`check-theme-tokens: ${offences.length} hardcoded colour(s) in themed screens:`)
  for (const o of offences) console.error(`  ${o.file}:${o.line}  ${o.snippet}\n    ${o.text}`)
  console.error('')
  console.error('Use a Tailwind theme token (bg-surface, text-ink-900, border-line,')
  console.error('bg-brand-tint, …) instead. Those resolve through CSS variables that the')
  console.error('dark palette redefines; a literal colour does not, so it survives into')
  console.error('dark mode looking wrong. See assets/css/theme.css.')
  process.exit(1)
}

console.log('Growth and calendar screens use theme tokens only -- no hardcoded colours.')
