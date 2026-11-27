// Switching an automation on "also for everyone who already meets it"
// (utils/automationBackfill.ts, server/utils/automationBackfill.ts): the
// activation dialog offers it where the trigger can be looked back on,
// counts who it would include over the window chosen, and the one-off pass
// enrols them -- through the same gates a bulk enrolment has, and never the
// same person twice.
//
// The rules are in test mode with one email step, so a run that walks is
// visible as the email it records.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface RunRow {
  patient_id: string | null
  appointment_id: string | null
  context: { backfill?: { by: string | null } } | null
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

describe('Automations: including those who already meet the trigger', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  const cron = (path: string) => cy.request({ method: 'POST', url: `/api/automations/${path}`, headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
  const patient = (firstName: string, extra: Record<string, unknown> = {}) =>
    cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Prueba', email: `relleno.${stamp()}@example.test`, phone: randomPhone(), ...extra })
  const missedVisit = (patientId: string, startsAt: string) =>
    cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt, status: 'no_show' })
  const rule = (name: string, trigger: Record<string, unknown>) =>
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      name,
      triggerEvent: 'atom',
      trigger: { timing: null, options: {}, ...trigger },
      enabled: false,
      dryRun: true,
      actions: [{ type: 'email', config: { subject: `Te echamos de menos ${stamp()}`, body: '<p>Hola {{first_name}}</p>' } }],
    })

  it('enrols who missed a visit in the window chosen, once, and leaves out who may not be contacted', () => {
    // Missed 3 days ago, 60 days ago, and 2 days ago but "do not contact".
    patient('Reciente').then((recent) => {
      patient('Antiguo').then((older) => {
        patient('Nocontactar', { doNotContact: true }).then((blocked) => {
          missedVisit(recent.id, daysAgo(3))
          missedVisit(older.id, daysAgo(60))
          missedVisit(blocked.id, daysAgo(2))

          rule('No vino a su cita', { subject: 'appointment', moment: 'no_show' }).then((r) => {
            cy.visit('/automations')
            const row = `[data-test="rule-${r.id}"]`
            cy.get(`${row} [data-test="rule-toggle"]`).click()

            // "Only from now on" is the default, and counts nothing.
            cy.get('[data-test="activate-backfill"]').should('be.visible')
            cy.get('[data-test="activate-scope-now"]').should('be.checked')
            cy.get('[data-test="activate-backfill-count"]').should('not.exist')

            // Also those who already met it: 30 days by default -- only the
            // recent one; 90 takes in the older one too. Never the blocked one.
            cy.get('[data-test="activate-scope-also"]').check()
            cy.get('[data-test="activate-backfill-days"]').should('have.value', '30')
            cy.get('[data-test="activate-backfill-count"]').should('have.text', 'This will include 1 patient.')
            cy.get('[data-test="activate-backfill-days"]').select('90')
            cy.get('[data-test="activate-backfill-count"]').should('have.text', 'This will include 2 patients.')

            cy.get('[data-cy="confirm-dialog-confirm"]').click()
            cy.contains('with 2 patients who already met it').should('be.visible')
            cy.get(`${row} [data-test="rule-toggle"]`).should('have.attr', 'aria-checked', 'true')

            cy.task<RunRow[]>('auto:runsForRule', { ruleId: r.id }).then((runs) => {
              expect(runs.map((x) => x.patient_id).sort()).to.deep.eq([recent.id, older.id].sort())
              runs.forEach((x) => {
                expect(x.appointment_id, 'the run carries the missed visit').to.be.a('string')
                expect(x.context?.backfill, 'marked as the switch-on pass').to.be.an('object')
              })
            })

            // Walked by the minute tick: each records its email (test mode).
            cron('lead-sequence-cron')
            cy.task<{ dry_run: boolean; rule_id: string | null }[]>('auto:emailsFor', { patientId: recent.id }).should((emails) => {
              expect(emails.filter((e) => e.rule_id === r.id)).to.have.length(1)
            })
            cy.task<unknown[]>('auto:emailsFor', { patientId: blocked.id }).should('have.length', 0)

            // Paused and switched on again the same way: everyone in the
            // window is already in, so nobody is counted or enrolled twice.
            cy.get(`${row} [data-test="rule-toggle"]`).click()
            cy.get(`${row} [data-test="rule-toggle"]`).should('have.attr', 'aria-checked', 'false')
            cy.get(`${row} [data-test="rule-toggle"]`).click()
            cy.get('[data-test="activate-scope-also"]').check()
            cy.get('[data-test="activate-backfill-days"]').select('90')
            cy.get('[data-test="activate-backfill-count"]').should('have.text', 'Nobody met it in that time.')
            cy.get('[data-cy="confirm-dialog-confirm"]').click()
            cy.get(`${row} [data-test="rule-toggle"]`).should('have.attr', 'aria-checked', 'true')
            cy.task<RunRow[]>('auto:runsForRule', { ruleId: r.id }).should('have.length', 2)
          })
        })
      })
    })
  })

  it('switched on from the builder, takes in the patients added in the window', () => {
    patient('Nuevo').then((fresh) => {
      rule('Bienvenida', { subject: 'patient', moment: 'created' }).then((r) => {
        cy.visit(`/automations/${r.id}`)
        cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'false').click()
        cy.get('[data-test="activate-scope-also"]').check()
        // The seeded account's own patients count too; this one is among them.
        cy.get('[data-test="activate-backfill-count"]').should('contain', 'This will include')
        cy.get('[data-cy="confirm-dialog-confirm"]').click()
        cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'true')
        cy.task<RunRow[]>('auto:runsForRule', { ruleId: r.id }).should((runs) => {
          expect(runs.map((x) => x.patient_id)).to.include(fresh.id)
        })
        // Claimed where the 15-minute check claims a new patient, so that
        // check does not start it a second time.
        cron('lead-sequence-cron')
        cy.task<RunRow[]>('auto:runsForRule', { ruleId: r.id }).should((runs) => {
          expect(runs.filter((x) => x.patient_id === fresh.id)).to.have.length(1)
        })
      })
    })
  })

  it('is not offered where the moment cannot be looked back on', () => {
    rule('Recordatorio', { subject: 'appointment', moment: 'start', timing: { amount: 24, unit: 'hours', direction: 'before' } }).then((r) => {
      cy.visit('/automations')
      cy.get(`[data-test="rule-${r.id}"] [data-test="rule-toggle"]`).click()
      cy.get('[data-test="activate-when"]').should('be.visible')
      cy.get('[data-test="activate-backfill"]').should('not.exist')
      cy.get('[data-cy="confirm-dialog-cancel"]').click()
    })
  })
})
