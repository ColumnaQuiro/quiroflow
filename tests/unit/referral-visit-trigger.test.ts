import { describe, expect, it } from 'vitest'
import { triggerDef, triggerTitle, VARIABLE_SOURCES, EMAIL_MERGE_FIELDS } from '../../utils/automationCatalog'
import { automationFieldValue } from '../../utils/automationFields'
import { FLOW_TEMPLATES } from '../../utils/automationTemplates'

// "Referred patient completes a visit": the message goes to whoever referred
// them, and {{referred_first_name}} says who came.

const es = (_en: string, esText: string) => esText
const carmen = { firstName: 'Carmen', lastName: 'Ruiz', email: 'carmen@example.test' }

describe('referral.visit_completed', () => {
  it('is a trigger with the visit in scope, so appointment-type and practitioner filters are offered', () => {
    const def = triggerDef('referral.visit_completed')
    expect(def?.appointmentContext).toBe(true)
    expect(def?.group).toBe('patient')
    expect(triggerTitle(es, 'referral.visit_completed', {})).toBe('Paciente referido completa una cita')
  })

  it('names the patient they referred, and nothing on any other trigger', () => {
    expect(automationFieldValue(carmen, 'referred_first_name', { referredFirstName: ' Marta ' })).toBe('Marta')
    expect(automationFieldValue(carmen, 'referred_first_name', {})).toBe('')
    expect(automationFieldValue(carmen, 'first_name', { referredFirstName: 'Marta' })).toBe('Carmen')
  })

  it('offers the variable to WhatsApp and email steps', () => {
    expect(VARIABLE_SOURCES.some((v) => v.value === 'referred_first_name')).toBe(true)
    expect(EMAIL_MERGE_FIELDS.some((v) => v.value === 'referred_first_name')).toBe(true)
  })

  it('ships a template that thanks them after the first visit only', () => {
    const tpl = FLOW_TEMPLATES.find((t) => t.key === 'referral-thanks')
    expect(tpl?.rule.trigger_event).toBe('referral.visit_completed')
    expect(tpl?.rule.filters).toEqual({ total_visits: 1 })
    expect(tpl?.steps[0]?.config?.variables).toEqual([{ source: 'first_name' }, { source: 'referred_first_name' }])
  })
})
