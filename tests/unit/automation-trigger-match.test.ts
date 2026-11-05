import { describe, it, expect } from 'vitest'
import { triggerBonoMatches, triggerCarePlanMatches, triggerDocMatches, triggerScoreMatches, triggerStageMatches, triggerTagMatches } from '../../utils/automationTriggerMatch'
import { TRIGGERS, isLeadTrigger, triggerTitle } from '../../utils/automationCatalog'

// A rule's own setting for the trigger that starts it: an empty one takes
// every event of its kind, a set one only its own.

describe('trigger settings', () => {
  it('matches a tag whatever its capitals or spaces', () => {
    expect(triggerTagMatches({ trigger_tag: ' Embarazada ' }, 'embarazada')).toBe(true)
    expect(triggerTagMatches({ trigger_tag: 'embarazada' }, 'deportista')).toBe(false)
    expect(triggerTagMatches({}, 'deportista')).toBe(true)
    expect(triggerTagMatches({ trigger_tag: '' }, 'deportista')).toBe(true)
  })

  it('splits scores at 4', () => {
    expect([1, 2, 3, 4, 5].filter((s) => triggerScoreMatches({ trigger_score: 'high' }, s))).toEqual([4, 5])
    expect([1, 2, 3, 4, 5].filter((s) => triggerScoreMatches({ trigger_score: 'low' }, s))).toEqual([1, 2, 3])
    expect([1, 2, 3, 4, 5].filter((s) => triggerScoreMatches(null, s))).toHaveLength(5)
  })

  it('takes any form until forms are chosen, and then only those', () => {
    expect(triggerDocMatches({}, null)).toBe(true)
    expect(triggerDocMatches({ trigger_doc_template_ids: ['a'] }, 'a')).toBe(true)
    expect(triggerDocMatches({ trigger_doc_template_ids: ['a'] }, 'b')).toBe(false)
    // A form not made from a template is not one of the chosen ones.
    expect(triggerDocMatches({ trigger_doc_template_ids: ['a'] }, null)).toBe(false)
  })

  it('matches the stage moved to', () => {
    expect(triggerStageMatches({ trigger_lead_stage: 'lost' }, 'lost')).toBe(true)
    expect(triggerStageMatches({ trigger_lead_stage: 'lost' }, 'contacted')).toBe(false)
    expect(triggerStageMatches({}, 'contacted')).toBe(true)
  })
})

describe('the new triggers in the catalog', () => {
  const t = (en: string) => en
  it('are offered, and lead stage moves are a lead automation', () => {
    for (const v of ['satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed']) expect(TRIGGERS.some((x) => x.value === v)).toBe(true)
    expect(isLeadTrigger('lead.stage_changed')).toBe(true)
    expect(isLeadTrigger('patient.tag_added')).toBe(false)
  })
  it('name their setting in the title', () => {
    expect(triggerTitle(t, 'patient.tag_added', { trigger_tag: 'embarazada' })).toBe('Tagged "embarazada"')
    expect(triggerTitle(t, 'satisfaction.answered', { trigger_score: 'low' })).toBe('Rated the visit 1-3')
    expect(triggerTitle(t, 'lead.stage_changed', { trigger_lead_stage: 'lost' })).toBe('Lead moved to Lost')
    expect(triggerTitle(t, 'doc.completed', {})).toBe('Form completed')
  })
})

describe('care plan and bono settings', () => {
  const plan = { total_visits: 12, markers: [{ at: 6, every: 6 }] }
  it('is due the visit before a marked re-exam, by default', () => {
    expect([4, 5, 6, 11].filter((k) => triggerCarePlanMatches({}, k, plan))).toEqual([5, 11])
  })
  it('knows the last visit, and a numbered one', () => {
    expect(triggerCarePlanMatches({ trigger_milestone: 'finished' }, 12, plan)).toBe(true)
    expect(triggerCarePlanMatches({ trigger_milestone: 'finished' }, 11, plan)).toBe(false)
    expect(triggerCarePlanMatches({ trigger_milestone: 'visit', trigger_visit_number: 3 }, 3, plan)).toBe(true)
  })
  it('counts sessions left, one by default', () => {
    expect([0, 1, 2].filter((n) => triggerBonoMatches({}, n))).toEqual([0, 1])
    expect([0, 1, 2].filter((n) => triggerBonoMatches({ trigger_sessions_left: 0 }, n))).toEqual([0])
  })
})
