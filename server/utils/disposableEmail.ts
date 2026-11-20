// Refusing throwaway inboxes (10minemail, yopmail, mailinator...) at clinic
// signup. Nobody running a clinic signs up with an address that vanishes in
// ten minutes; the people who do want to look around without being
// identifiable, and the account they leave behind is one nobody can reach.
//
// The list has to be FRESH to be worth anything. These services mint a new
// domain every day or two precisely so that blocklists fall behind: the
// signup that prompted this (20 Nov 2026) used a domain FakeFilter had first
// seen the day before and the better-known disposable-email-domains list did
// not have yet. A list copied into the repo would have been stale the day it
// merged, so both are read live and kept in memory for a few hours per
// function instance.
//
// Fails open. If neither list can be fetched the check falls back to the
// handful of domains below, and an address it cannot judge is let through:
// a real clinic refused because GitHub was slow is the worse outcome.
//
// No top-level imports beyond the built-in fetch, on purpose: everything in
// server/utils runs on every cold start (see CLAUDE.md).

const SOURCES = [
  // Curated, with an allowlist of its own; slower to pick up new domains.
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf',
  // Collected daily from the temp-mail services themselves.
  'https://raw.githubusercontent.com/7c/fakefilter/main/txt/data.txt',
]

const FRESH_FOR_MS = 6 * 60 * 60 * 1000
/** After a failed fetch, try again sooner than a full refresh. */
const RETRY_AFTER_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

/** Always refused, whether or not the live lists answer. */
const ALWAYS_DISPOSABLE = [
  'forims.com',
  '10minemail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'maildrop.cc',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'trashmail.com',
  'yopmail.com',
]

/**
 * Never refused, whatever a list says. Both lists are collected partly by
 * machine, and one bad entry here would lock out most of Spain's clinics.
 */
const NEVER_DISPOSABLE = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.es',
  'telefonica.net',
  'movistar.es',
  'orange.es',
  'vodafone.es',
])

/** One domain per line, `#` comments and blank lines skipped, lower-cased. */
export function parseDomainList(text: string): string[] {
  const domains: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim().toLowerCase()
    if (!line || line.startsWith('#')) continue
    domains.push(line)
  }
  return domains
}

/** The part after the last `@`, lower-cased, without a trailing dot. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Whether `domain` or any parent of it is on the list -- these services hand
 * out subdomains too (`x@inbox.example-temp.com`). Stops before the bare TLD.
 */
export function isListedDomain(domain: string, listed: ReadonlySet<string>): boolean {
  if (!domain) return false
  const labels = domain.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.')
    if (NEVER_DISPOSABLE.has(candidate)) return false
    if (listed.has(candidate)) return true
  }
  return false
}

let cached: { domains: Set<string>; expiresAt: number } | null = null
let loading: Promise<Set<string>> | null = null

async function fetchList(url: string): Promise<string[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return parseDomainList(await res.text())
}

async function loadDomains(): Promise<Set<string>> {
  const results = await Promise.allSettled(SOURCES.map(fetchList))
  const domains = new Set(ALWAYS_DISPOSABLE)
  let fetched = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      fetched++
      for (const d of result.value) domains.add(d)
    } else {
      console.error('[disposable-email] list unavailable:', String(result.reason))
    }
  }
  const complete = fetched === SOURCES.length
  // Keep a previous good list over a worse one: one source failing should
  // not shrink what was already known.
  if (!complete && cached && cached.domains.size > domains.size) {
    cached = { domains: cached.domains, expiresAt: Date.now() + RETRY_AFTER_MS }
    return cached.domains
  }
  cached = { domains, expiresAt: Date.now() + (complete ? FRESH_FOR_MS : RETRY_AFTER_MS) }
  return domains
}

async function disposableDomains(): Promise<Set<string>> {
  if (cached && cached.expiresAt > Date.now()) return cached.domains
  loading ??= loadDomains().finally(() => {
    loading = null
  })
  return loading
}

/** True when the address belongs to a known throwaway-inbox service. */
export async function isDisposableEmail(email: string): Promise<boolean> {
  const domain = emailDomain(email)
  if (!domain) return false
  return isListedDomain(domain, await disposableDomains())
}
