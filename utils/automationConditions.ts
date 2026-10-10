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
  /** 'doc_answer' only: which form, and which question on it. */
  doc_template_id?: string
  doc_field_id?: string
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
  // An answer on a form the automation sent: a review request for whoever
  // scored the visit 8 or more, a call for whoever scored it low.
  'doc_answer',
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]
/**
 * Keyed by factKey(), not by field: a branch may ask about two answers, and
 * both are 'doc_answer'.
 */
export type ConditionFacts = Partial<Record<ConditionField, unknown>> & { [key: string]: unknown }

/** Where a condition's fact is kept in ConditionFacts. */
export function factKey(c: Pick<Condition, 'field' | 'doc_template_id' | 'doc_field_id'>): string {
  return c.field === 'doc_answer' ? `doc_answer:${c.doc_template_id ?? ''}:${c.doc_field_id ?? ''}` : c.field
}

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
  const results = conditions.map((c) => conditionHolds(facts[factKey(c)], c.op, c.value))
  return config?.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/** The fields a branch reads, so only those are looked up. */
export function fieldsUsed(config: BranchConfig | null | undefined): Set<string> {
  return new Set((config?.conditions ?? []).map((c) => c.field))
}
