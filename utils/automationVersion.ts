// A fingerprint of an automation AS STORED: the rule's editable columns and
// its tree of steps. The builder keeps the one it loaded and sends it with
// every save; the server works out the stored one again and refuses the save
// (409, `conflict`) when they differ -- somebody else, or this same person in
// another tab, saved it in between.
//
// Before auto-save that was a rare race. With it, a second tab left open on
// the same automation would write its whole stale tree back on the next
// keystroke: steps added in the other tab gone, removed ones back.
//
// `enabled` is deliberately left out. Switching on and off has its own route
// and its own checks, an auto-save never sends it, and a pause made from the
// list must not make every open builder report a conflict.
//
// Computed from the rows exactly as PostgREST returns them, on both sides, so
// the browser and the server agree without either trusting the other's copy.

// `trigger` is the atom (utils/automationTrigger.ts); `trigger_event` is what
// the engine derives from it, kept for the rows and crons that still read it.
// Both are here: a trigger, timing or filter changed in another tab moves
// one of them, and that is a conflict like any other edit.
const RULE_FIELDS = ['name', 'trigger', 'trigger_event', 'filters', 'is_marketing', 'dry_run', 'entry_mode', 'exit_on', 'quiet_hours', 'segment'] as const
const STEP_FIELDS = ['id', 'action_type', 'position', 'config', 'parent_id', 'branch'] as const

/** JSON with object keys sorted, so key order in a jsonb column never matters. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`
}

/** cyrb53: a fast 53-bit string hash. Not cryptographic; it only has to tell two versions apart. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function automationTreeVersion(rule: object, steps: readonly object[]): string {
  const r = Object.fromEntries(RULE_FIELDS.map((k) => [k, (rule as Record<string, unknown>)[k] ?? null]))
  const s = steps
    .map((step) => {
      const row: Record<string, unknown> = Object.fromEntries(STEP_FIELDS.map((k) => [k, (step as Record<string, unknown>)[k] ?? null]))
      if (row.config === null) row.config = {}
      return row
    })
    // Code-unit order, not localeCompare: the browser and Node must sort alike.
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
  return cyrb53(canonical({ rule: r, steps: s }))
}
