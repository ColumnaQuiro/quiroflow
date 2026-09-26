// The builder's canvas, end to end: a branching automation built with the
// mouse, saved, switched on, and then driven through the engine -- the
// trigger fired, the tick run with the cron secret -- to prove that what the
// canvas draws is what the engine walks. And the property the save API
// exists for: step ids stay put across saves, so a person parked on a step
// is still on it afterwards.
//
// Sends are asserted through test mode (dry run), as in the engine specs.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}
interface Step {
  id: string
  action_type: string
  position: number
  parent_id: string | null
  branch: string | null
  config: Record<string, any>
}
interface Run {
  id: string
  status: string
  current_action_id: string | null
  next_position: number
  waiting_for: string | null
}

const TEMPLATES = {
  templates: ['primera', 'segunda'].map((name) => ({
    name,
    language: 'es',
    category: 'UTILITY',
    status: 'APPROVED',
    bodyText: 'Hola {{1}}',
    variableCount: 1,
    urlButtonCount: 0,
    mediaHeaderFormat: null,
    buttons: [],
  })),
}
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Automation canvas', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: TEMPLATES })
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const tick = () =>
    cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
  const patient = (extra: Record<string, unknown> = {}) =>
    cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lienzo', phone: randomPhone(), ...extra })
  const templates = (patientId: string) => cy.task<{ template_name: string }[]>('auto:whatsappFor', { patientId }).then((rows) => rows.map((r) => r.template_name))
  function complete(patientId: string) {
    return cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt: new Date().toISOString() }).then((appt) =>
      cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId, appointmentId: appt.id } }),
    )
  }
  function add(insert: string, type: string) {
    cy.get(insert).click({ force: true })
    cy.get(`[data-test="add-step-${type}"]`).click()
    cy.get('[data-test="inspector"]').should('be.visible')
  }

  it('builds a flow with two paths, and the engine walks the one each person qualifies for', () => {
    cy.visit('/automations/new')
    cy.get('[data-test="node-trigger"]').should('be.visible')
    cy.get('[data-test="automation-name"]').clear().type('Seguimiento VIP')
    cy.get('[data-test="trigger-select"]').should('have.value', 'appointment.completed')

    add('[data-test="insert-root-root-0"]', 'whatsapp_template')
    cy.get('[data-test="template-select"]').select('primera::es')

    add('[data-test="insert-root-root-1"]', 'branch')
    cy.get('[data-test="branch-title"]').type('¿Es VIP?')
    cy.get('[data-test="condition-add"]').click()
    cy.get('[data-test="condition-0"] [data-test="condition-field"]').select('tags')
    cy.get('[data-test="condition-0"] [data-test="condition-op"]').select('contains')
    cy.get('[data-test="condition-0"] [data-test="condition-value"]').type('vip')

    // The fork draws its two paths, each ending, each with its own "+".
    cy.get('[data-test^="outlet-"][data-test$="-yes"]').should('contain', 'Yes')
    cy.get('[data-test^="outlet-"][data-test$="-no"]').should('contain', 'No')

    add('[data-test^="insert-"][data-test$="-yes-0"]', 'tag')
    cy.get('[data-test="tag-input"]').type('cuidado-vip')
    add('[data-test^="insert-"][data-test$="-no-0"]', 'delay')
    add('[data-test^="insert-"][data-test$="-no-1"]', 'whatsapp_template')
    cy.get('[data-test="template-select"]').select('segunda::es')

    // Nothing can follow the fork in its own chain: there is no "+" after it.
    cy.get('[data-test="insert-root-root-2"]').should('not.exist')

    cy.get('[data-test="tab-settings"]').click()
    cy.get('[data-test="dry-run-toggle"]').click()
    cy.get('[data-test="tab-flow"]').click()

    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.get('[data-test="save-bar"]').should('not.exist')
    cy.get('[data-test="automation-enabled"]').click()
    cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'true')

    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      cy.task<Step[]>('auto:actionsForRule', { ruleId }).then((steps) => {
        const branch = steps.find((s) => s.action_type === 'branch')!
        expect(branch.parent_id, 'the fork is on the root chain').to.be.null
        expect(branch.config.conditions).to.deep.eq([{ field: 'tags', op: 'contains', value: 'vip' }])
        expect(steps.filter((s) => s.parent_id === branch.id && s.branch === 'yes').map((s) => s.action_type)).to.deep.eq(['tag'])
        expect(steps.filter((s) => s.parent_id === branch.id && s.branch === 'no').sort((a, b) => a.position - b.position).map((s) => s.action_type)).to.deep.eq(['delay', 'whatsapp_template'])
      })

      patient({ tags: ['vip'] }).then((vip) => {
        patient().then((other) => {
          complete(vip.id)
          complete(other.id)
          templates(vip.id).should('deep.eq', ['primera'])
          templates(other.id).should('deep.eq', ['primera'])
          // Test mode changes nothing -- the tag is recorded, not written --
          // so the path each took is read from their history.
          cy.task<(Run & { patient_id: string })[]>('auto:runsForRule', { ruleId }).then((runs) => {
            const vipRun = runs.find((r) => r.patient_id === vip.id)!
            const otherRun = runs.find((r) => r.patient_id === other.id)!
            cy.task<{ outcome: string; detail: string | null; step_label: string | null }[]>('db:runEvents', { runId: vipRun.id }).then((ev) => {
              expect(ev.find((e) => e.outcome === 'branched')?.detail).to.eq('Yes')
              expect(ev.some((e) => e.outcome === 'dry_run' && e.step_label === 'Add tag · cuidado-vip')).to.eq(true)
              expect(ev.at(-1)?.outcome).to.eq('finished')
            })
            cy.task<{ outcome: string; detail: string | null }[]>('db:runEvents', { runId: otherRun.id }).then((ev) => {
              expect(ev.find((e) => e.outcome === 'branched')?.detail).to.eq('No')
              expect(ev.at(-1)?.outcome).to.eq('waiting')
            })
          })

          // The "no" path waits a day; the tick sends the rest once it is due.
          tick()
          templates(other.id).should('deep.eq', ['primera'])
          cy.task('auto:makeRunsDue', { ruleId })
          tick()
          templates(other.id).should('deep.eq', ['primera', 'segunda'])
          templates(vip.id).should('deep.eq', ['primera'])
          cy.task<Run[]>('auto:runsForRule', { ruleId }).then((runs) => {
            expect(runs.map((r) => r.status)).to.deep.eq(['done', 'done'])
          })

          // The canvas counts what went down each path.
          cy.reload()
          cy.get('[data-test="canvas-fit"]').click()
          cy.contains('[data-test="node-stats"]', 'Yes 1 · No 1').should('exist')
        })
      })
    })
  })

  it('keeps step ids across saves, so someone parked on a step is still on it', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      steps: [
        { type: 'delay', config: { delay_minutes: 1440 } },
        { type: 'whatsapp_template', config: { template_name: 'despues', template_language: 'es' } },
      ],
    }).then((rule) => {
      cy.task<Step[]>('auto:actionsForRule', { ruleId: rule.id }).then((before) => {
        const delay = before.find((s) => s.action_type === 'delay')!
        const wa = before.find((s) => s.action_type === 'whatsapp_template')!
        patient().then((p) => {
          complete(p.id)
          cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            expect(runs[0]!.current_action_id).to.eq(delay.id)
            expect(runs[0]!.next_position).to.eq(1)
          })

          // A step added ABOVE the parked person.
          cy.visit(`/automations/${rule.id}`)
          cy.get('[data-test="canvas-fit"]').click()
          add('[data-test="insert-root-root-0"]', 'tag')
          cy.get('[data-test="tag-input"]').type('nuevo')
          cy.get('[data-test="save-bar-save"]').click()
          cy.get('[data-test="save-bar"]').should('not.exist')

          cy.task<Step[]>('auto:actionsForRule', { ruleId: rule.id }).then((after) => {
            expect(after.find((s) => s.id === delay.id)?.position, 'same delay row, moved down one').to.eq(1)
            expect(after.find((s) => s.id === wa.id)?.position).to.eq(2)
            expect(after.find((s) => s.action_type === 'tag')?.position).to.eq(0)
          })
          cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            expect(runs[0]!.current_action_id, 'still on the same step').to.eq(delay.id)
            // Its root-chain cursor followed the step, or the tick would run
            // the delay again (or the new tag) instead of what comes next.
            expect(runs[0]!.next_position).to.eq(2)
          })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          templates(p.id).should('deep.eq', ['despues'])
          // The new step is behind them: not applied.
          cy.task<string[]>('auto:patientTags', { patientId: p.id }).should('not.include', 'nuevo')
        })

        // Removing the step someone is on asks what to do with them.
        patient().then((q) => {
          complete(q.id)
          cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            const parked = runs.find((r) => r.status === 'running')!
            expect(parked.current_action_id, 'parked at the delay').to.eq(delay.id)
          })
          cy.visit(`/automations/${rule.id}`)
          cy.get('[data-test="canvas-fit"]').click()
          cy.get(`[data-test="node-${delay.id}"]`).click({ force: true })
          cy.get('[data-test="step-remove"]').click()
          cy.get('[data-test="save-bar-save"]').click()
          cy.get('[data-test="removed-steps-summary"]').should('contain', '1 person')
          cy.get('[data-test="removed-move-on"]').should('be.checked')
          cy.get('[data-cy="confirm-dialog-confirm"]').click()
          cy.get('[data-test="save-bar"]').should('not.exist')
          cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            const moved = runs.find((r) => r.status === 'running')!
            expect(moved.current_action_id, 'moved on to what followed the delay').to.eq(wa.id)
          })
          tick()
          templates(q.id).should('deep.eq', ['despues'])
        })
      })
    })
  })

  it('refuses a step that hangs from another automation', () => {
    cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, triggerEvent: 'appointment.completed', enabled: false, steps: [{ type: 'branch', config: {} }] }).then((other) => {
      cy.task<Step[]>('auto:actionsForRule', { ruleId: other.id }).then(([foreign]) => {
        cy.request({
          method: 'POST',
          url: '/api/automations',
          failOnStatusCode: false,
          body: {
            rule: { name: 'x', trigger_event: 'appointment.completed' },
            steps: [{ id: '3f8f1c1e-7a57-4c55-9a40-7d4f0f6b0c11', action_type: 'tag', config: { tag: 'a' }, parent_id: foreign!.id, branch: 'yes', position: 0 }],
          },
        }).its('status').should('eq', 400)
      })
    })
  })
})
