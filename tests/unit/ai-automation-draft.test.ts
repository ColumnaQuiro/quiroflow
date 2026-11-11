import { describe, it, expect } from 'vitest'
import { aiAutomationDraftSchema, aiAutomationDraftSystemPrompt, cleanAiAutomationDraft } from '../../utils/aiAutomationDraft'
import { findProblems, type DraftStep } from '../../utils/automationTree'

// The model is asked for the builder's rule and steps. These are the cases
// where it hands back something else, and what the clinic then sees.

const TEMPLATES = [{ name: 'recordatorio_revision', language: 'es', variableCount: 2 }]
const CTX = { growth: true, templates: TEMPLATES, emailFieldKeys: ['first_name', 'clinic_name'] }

function ids() {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}
function step(over: Record<string, unknown>) {
  return {
    ref: 's1', under: '', path: '', type: 'delay', wait_amount: 0, wait_unit: 'days', wait_event: 'none', match: 'all', conditions: [], tag: '', tag_mode: 'add',
    whatsapp_template: '', whatsapp_variables: [], notify_who: 'none', notify_text: '', lead_stage: 'none',
    email: { subject: '', preheader: '', blocks: [] },
    ...over,
  }
}
const email = (subject: string, text: string) => ({ subject, preheader: '', blocks: [{ type: 'text', text: '', paragraphs: [text], link: 'none', align: 'left' }] })
const shape = (steps: DraftStep[]) => steps.map((s) => [s.action_type, s.parent_id ? s.parent_id.slice(-1) : null, s.branch, s.position])

describe('cleanAiAutomationDraft', () => {
  it('builds a rule and a tree the builder finds nothing missing in', () => {
    const draft = cleanAiAutomationDraft(
      {
        name: 'Revisión a los 3 meses',
        trigger: 'appointment.completed',
        trigger_number: 0,
        trigger_tag: '',
        is_marketing: false,
        entry_mode: 'one_at_a_time',
        exit_on: ['appointment.booked'],
        steps: [
          step({ ref: 's1', type: 'delay', wait_amount: 12, wait_unit: 'weeks' }),
          step({ ref: 's2', type: 'whatsapp', whatsapp_template: 'recordatorio_revision', whatsapp_variables: ['first_name', 'practitioner_first_name'] }),
          step({ ref: 's3', type: 'wait_until', wait_event: 'appointment.booked', wait_amount: 7, wait_unit: 'days' }),
          step({ ref: 's4', under: 's3', path: 'timeout', type: 'email', email: email('{{first_name}}, ¿reservamos?', 'Hola {{first_name}}') }),
          step({ ref: 's5', under: 's3', path: 'met', type: 'tag', tag: 'volvió' }),
        ],
      },
      CTX,
      ids(),
    )
    expect(draft.rule).to.deep.include({ name: 'Revisión a los 3 meses', trigger_event: 'appointment.completed', is_marketing: false, entry_mode: 'one_at_a_time', dry_run: false })
    expect(draft.rule.exit_on).to.deep.equal(['appointment.booked'])
    expect(shape(draft.steps)).to.deep.equal([
      ['delay', null, null, 0],
      ['whatsapp_template', null, null, 1],
      ['wait_until', null, null, 2],
      ['email', '3', 'timeout', 0],
      ['tag', '3', 'met', 0],
    ])
    expect(draft.steps[0]!.config).to.deep.equal({ delay_minutes: 12 * 10080 })
    expect(draft.steps[1]!.config.variables).to.deep.equal([{ source: 'first_name' }, { source: 'practitioner_first_name' }])
    expect(findProblems(draft.rule, draft.steps, [{ ...TEMPLATES[0]!, status: 'APPROVED', urlButtonCount: 0, mediaHeaderFormat: null }])).to.deep.equal([])
  })

  it('moves what follows a fork in its own sequence into the fork\'s first path', () => {
    const draft = cleanAiAutomationDraft(
      {
        name: 'x', trigger: 'appointment.completed', trigger_number: 0, trigger_tag: '', is_marketing: false, entry_mode: 'every_time', exit_on: [],
        steps: [
          step({ ref: 'a', type: 'branch', conditions: [{ field: 'has_email', op: 'is_true', value: '' }] }),
          step({ ref: 'b', type: 'tag', tag: 'uno' }),
          step({ ref: 'c', type: 'wait_until', wait_event: 'email.opened', wait_amount: 3, wait_unit: 'days' }),
          step({ ref: 'd', type: 'tag', tag: 'dos' }),
        ],
      },
      CTX,
      ids(),
    )
    // b and c go under a's "yes"; d, which then follows c there, under c's "met".
    expect(shape(draft.steps)).to.deep.equal([
      ['branch', null, null, 0],
      ['tag', '1', 'yes', 0],
      ['wait_until', '1', 'yes', 1],
      ['tag', '3', 'met', 0],
    ])
  })

  it('leaves out what it cannot fill: unknown templates, empty steps, ids it has never seen', () => {
    const draft = cleanAiAutomationDraft(
      {
        name: 'x', trigger: 'appointment.completed', trigger_number: 0, trigger_tag: '', is_marketing: false, entry_mode: 'every_time', exit_on: [],
        steps: [
          step({ ref: 's1', type: 'whatsapp', whatsapp_template: 'made_up_template' }),
          step({ ref: 's2', type: 'delay', wait_amount: 0 }),
          step({ ref: 's3', type: 'branch', conditions: [{ field: 'appointment_type_id', op: 'in', value: 'Primera visita' }] }),
          step({ ref: 's4', type: 'tag', tag: '  ' }),
          step({ ref: 's5', type: 'email', email: { subject: 'x', preheader: '', blocks: [] } }),
          step({ ref: 's6', type: 'tag', tag: 'ok' }),
        ],
      },
      CTX,
    )
    expect(draft.steps.map((s) => s.action_type)).to.deep.equal(['tag'])
  })

  it('keeps a template but leaves its variables for staff when the count is wrong', () => {
    const draft = cleanAiAutomationDraft(
      { name: 'x', trigger: 'appointment.completed', trigger_number: 0, trigger_tag: '', is_marketing: false, entry_mode: 'every_time', exit_on: [], steps: [step({ type: 'whatsapp', whatsapp_template: 'recordatorio_revision', whatsapp_variables: ['first_name'] })] },
      CTX,
    )
    expect(draft.steps[0]!.config.variables).to.deep.equal([])
    expect(findProblems(draft.rule, draft.steps, [{ ...TEMPLATES[0]!, status: 'APPROVED', urlButtonCount: 0, mediaHeaderFormat: null }]).length).to.be.greaterThan(0)
  })

  it('sets the trigger\'s own number, and falls back to a working value', () => {
    const base = { name: 'x', trigger_tag: '', is_marketing: false, entry_mode: 'every_time', exit_on: [], steps: [step({ type: 'tag', tag: 't' })] }
    expect(cleanAiAutomationDraft({ ...base, trigger: 'appointment.hours_before', trigger_number: 48 }, CTX).rule.filters).to.deep.equal({ hours_before: 48 })
    expect(cleanAiAutomationDraft({ ...base, trigger: 'invoice.overdue', trigger_number: -3 }, CTX).rule.filters).to.deep.equal({ days_overdue: 7 })
    expect(cleanAiAutomationDraft({ ...base, trigger: 'patient.tag_added', trigger_number: 0, trigger_tag: 'vip' }, CTX).rule.filters).to.deep.equal({ trigger_tag: 'vip' })
  })

  it('refuses lead triggers and lead steps to a clinic without Growth', () => {
    const draft = cleanAiAutomationDraft(
      { name: 'x', trigger: 'lead.created', trigger_number: 0, trigger_tag: '', is_marketing: false, entry_mode: 'every_time', exit_on: ['lead.converted'], steps: [step({ type: 'lead_stage', lead_stage: 'contacted' }), step({ ref: 's2', type: 'tag', tag: 't' })] },
      { ...CTX, growth: false },
    )
    expect(draft.rule.trigger_event).to.equal('appointment.completed')
    expect(draft.rule.exit_on).to.deep.equal([])
    expect(draft.steps.map((s) => s.action_type)).to.deep.equal(['tag'])
  })

  it('never throws on an answer that is not an automation', () => {
    for (const raw of [null, 'x', 1, [], { steps: 'no' }, { steps: [null, 3, { ref: '' }] }]) {
      expect(cleanAiAutomationDraft(raw, CTX).steps).to.deep.equal([])
    }
  })
})

describe('the automation prompt and schema', () => {
  it('lists the clinic\'s templates, and offers only those by name', () => {
    const prompt = aiAutomationDraftSystemPrompt({ language: 'es', growth: false, templates: [{ name: 'recordatorio_revision', language: 'es', bodyText: 'Hola {{1}}', variableCount: 1 }], emailFields: [{ key: 'first_name', label: 'First name' }] })
    expect(prompt).to.contain('- recordatorio_revision (es, 1 variable): Hola {{1}}')
    expect(prompt).not.to.contain('lead.created:')
    const schema = aiAutomationDraftSchema([{ name: 'recordatorio_revision' }])
    expect(schema.properties.steps.items.properties.whatsapp_template.enum).to.deep.equal(['', 'recordatorio_revision'])
  })
})
