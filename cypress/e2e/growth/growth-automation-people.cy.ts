// People: who is inside an automation, where, and the three things a person
// can do about one of them -- skip to the next step, take them out, retry a
// failed step (retry is also driven through the lead drip in
// growth-lead-sequences.cy.ts). Patients here: the Executions view was
// lead-only, and this is it for everyone.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}
interface Run {
  id: string
  status: string
  patient_id: string
  stopped_reason: string | null
  current_action_id: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Automation people', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const patient = (firstName: string) => cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Dentro', phone: randomPhone() })
  const fire = (patientId: string) => cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId } })
  const templates = (patientId: string) => cy.task<{ template_name: string }[]>('auto:whatsappFor', { patientId }).then((rows) => rows.map((r) => r.template_name))

  it('lists who is inside and where, and moves one on or takes one out', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      steps: [
        { type: 'delay', config: { delay_minutes: 2880 } },
        { type: 'whatsapp_template', config: { template_name: 'tras_espera', template_language: 'es' } },
      ],
    }).then((rule) => {
      patient('Marta').then((marta) => {
        patient('Jorge').then((jorge) => {
          fire(marta.id)
          fire(jorge.id)

          cy.visit(`/automations/${rule.id}`)
          cy.get('[data-test="tab-people"]').should('contain', '2').click()
          cy.get('[data-test="people-tab-running"]').should('contain', '2')
          cy.get('[data-test^="run-"]').filter(':contains("Marta Dentro")').should('contain', 'Wait 2 days').and('contain', 'continues')

          // Skip: past the wait, the next step runs now.
          cy.contains('[data-test^="run-"]', 'Marta Dentro').click()
          cy.get('[data-test="run-detail"]').should('contain', 'Marta Dentro')
          cy.get('[data-test="run-skip"]').click()
          cy.get('[data-test="run-events"]').should('contain', 'Skipped')
          templates(marta.id).should('deep.eq', ['tras_espera'])

          // Take out: nothing more is sent.
          cy.contains('[data-test^="run-"]', 'Jorge Dentro').click()
          cy.get('[data-test="run-remove"]').click()
          cy.get('[data-test="run-events"]').should('contain', 'Taken out by someone on the team')
          cy.get('[data-test="people-tab-running"]').should('contain', '0')
          cy.get('[data-test="people-tab-exited"]').should('contain', '1').click()
          cy.contains('[data-test^="run-"]', 'Jorge Dentro').should('contain', 'Taken out by someone on the team')
          cy.get('[data-test="people-tab-done"]').should('contain', '1')

          cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            expect(runs.find((r) => r.patient_id === marta.id)!.status).to.eq('done')
            const out = runs.find((r) => r.patient_id === jorge.id)!
            expect(out.status).to.eq('cancelled')
            expect(out.stopped_reason).to.eq('taken_out')
          })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
          templates(jorge.id).should('deep.eq', [])

          // History shows it all, newest first.
          cy.get('[data-test="tab-history"]').click()
          cy.get('[data-test="history-event"]').should('have.length.at.least', 4)
          cy.get('[data-test="history-whatsapp"]').should('contain', 'tras_espera')
        })
      })
    })
  })

  it('refuses to act on someone who has already left', () => {
    cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, triggerEvent: 'appointment.completed', steps: [{ type: 'tag', config: { tag: 'x' } }] }).then((rule) => {
      patient('Hecha').then((p) => {
        fire(p.id)
        cy.task<Run[]>('auto:runsForRule', { ruleId: rule.id }).then(([run]) => {
          expect(run!.status).to.eq('done')
          cy.request({ method: 'POST', url: `/api/automations/runs/${run!.id}/skip`, failOnStatusCode: false }).its('status').should('eq', 409)
          cy.request({ method: 'POST', url: `/api/automations/runs/${run!.id}/remove`, failOnStatusCode: false }).its('status').should('eq', 409)
          cy.request({ method: 'POST', url: `/api/automations/runs/${run!.id}/retry`, failOnStatusCode: false }).its('status').should('eq', 409)
        })
      })
    })
  })

  it('deletes an automation with people inside, after saying how many', () => {
    cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, name: 'Borrar', triggerEvent: 'appointment.completed', steps: [{ type: 'delay', config: { delay_minutes: 600 } }, { type: 'tag', config: { tag: 'x' } }] }).then((rule) => {
      patient('Uno').then((p) => {
        fire(p.id)
        cy.visit(`/automations/${rule.id}?tab=settings`)
        cy.get('[data-test="settings-delete"]').click()
        cy.get('[data-test="delete-inside"]').should('contain', '1 person inside')
        cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
        cy.get('[data-cy="confirm-dialog-word"]').type('Borrar')
        cy.get('[data-cy="confirm-dialog-confirm"]').click()
        cy.location('pathname').should('eq', '/automations')
        cy.task('auto:runsForRule', { ruleId: rule.id }).should('have.length', 0)
      })
    })
  })
})
