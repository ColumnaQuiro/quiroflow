// Whether a rule's own trigger settings take a particular event -- which tag,
// which score, which form, which lead stage. Stored in automation_rules.filters
// beside the "only if" filters, under trigger_* keys so evaluateAutomationFilters
// never mistakes one for a filter of its own (tag_contains is one: "has a tag
// containing", a different question from "this tag was just added").
//
// An empty setting takes every event of its kind. Pure, so the server and the
// unit tests ask the same question.

type Filters = Record<string, unknown> | null | undefined

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/** patient.tag_added / patient.tag_removed: the tag, ignoring case and spaces at either end. */
export function triggerTagMatches(filters: Filters, tag: string): boolean {
  const want = norm(filters?.trigger_tag)
  return !want || want === norm(tag)
}

/** satisfaction.answered: 'high' is 4-5, 'low' is 1-3, anything else any score. */
export function triggerScoreMatches(filters: Filters, score: number): boolean {
  if (filters?.trigger_score === 'high') return score >= 4
  if (filters?.trigger_score === 'low') return score <= 3
  return true
}

/** doc.completed: one of these form templates, or any form when none is chosen. */
export function triggerDocMatches(filters: Filters, templateId: string | null): boolean {
  const ids = Array.isArray(filters?.trigger_doc_template_ids) ? (filters!.trigger_doc_template_ids as unknown[]).filter((x) => typeof x === 'string') : []
  return ids.length === 0 || (!!templateId && ids.includes(templateId))
}

/** lead.stage_changed: the stage it was moved to. */
export function triggerStageMatches(filters: Filters, stage: string): boolean {
  const want = filters?.trigger_lead_stage
  return typeof want !== 'string' || !want || want === stage
}
