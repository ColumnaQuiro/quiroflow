// A `branch` step's question, answered against what is true of the person at
// the moment the run reaches it.
//
// Pure: the server gathers the facts (server/utils/automationEngine.ts), this
// decides. Kept apart so the rules of comparison -- which are easy to get
// subtly wrong, and decide who is messaged -- are testable without a
// database.

export type ConditionOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_true'
  | 'is_false'

export interface Condition {
  field: string
  op: ConditionOp
  value?: unknown
}

export interface BranchConfig {
  match?: 'all' | 'any'
  conditions?: Condition[]
}

/**
 * Every field a condition can name. The engine only computes the ones a
 * branch actually uses; an unknown field reads as undefined and fails its
 * test, so a typo sends people down "no" rather than "yes".
 */
export const CONDITION_FIELDS = [
  // Patient
  'tags',
  'marketing_channels',
  'has_future_appointment',
  'total_visits',
  'balance_cents',
  'membership_active',
  'appointment_type_id',
  'practitioner_id',
  // Either
  'replied_since_start',
  'email_opened_since_start',
  'email_clicked_since_start',
  'has_email',
  'has_phone',
  // Lead
  'lead_stage',
  'lead_source',
  'lead_channel',
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]
export type ConditionFacts = Partial<Record<ConditionField, unknown>>

const lower = (v: unknown) => String(v ?? '').toLowerCase()

export function conditionHolds(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  switch (op) {
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false
    case 'is':
      if (Array.isArray(actual)) return actual.some((a) => lower(a) === lower(expected))
      if (typeof actual === 'boolean' || typeof actual === 'number') return actual === expected
      return actual !== undefined && actual !== null && lower(actual) === lower(expected)
    case 'is_not':
      if (actual === undefined) return false
      return !conditionHolds(actual, 'is', expected)
    case 'contains':
      // Same "contains, case-insensitive" meaning as the tag_contains filter:
      // patients.tags holds messy imported values like "1x10|No contactar".
      if (Array.isArray(actual)) return actual.some((a) => lower(a).includes(lower(expected)))
      return typeof actual === 'string' && lower(actual).includes(lower(expected))
    case 'not_contains':
      if (actual === undefined || actual === null) return false
      return !conditionHolds(actual, 'contains', expected)
    case 'in':
      return Array.isArray(expected) && actual !== undefined && actual !== null && expected.some((e) => lower(e) === lower(actual))
    case 'not_in':
      return Array.isArray(expected) && actual !== undefined && actual !== null && !expected.some((e) => lower(e) === lower(actual))
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = Number(actual)
      const b = Number(expected)
      if (actual === undefined || actual === null || !Number.isFinite(a) || !Number.isFinite(b)) return false
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
    }
    default:
      return false
  }
}

/**
 * "yes" or "no". A branch with no conditions is "yes" -- it asks nothing, so
 * nothing is false -- which keeps a half-built branch from silently routing
 * everyone down the other side.
 */
export function evaluateBranch(config: BranchConfig | null | undefined, facts: ConditionFacts): boolean {
  const conditions = config?.conditions ?? []
  if (conditions.length === 0) return true
  const results = conditions.map((c) => conditionHolds(facts[c.field as ConditionField], c.op, c.value))
  return config?.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/** The fields a branch reads, so only those are looked up. */
export function fieldsUsed(config: BranchConfig | null | undefined): Set<string> {
  return new Set((config?.conditions ?? []).map((c) => c.field))
}
