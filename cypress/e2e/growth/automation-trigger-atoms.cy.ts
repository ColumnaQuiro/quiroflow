import { autoSaved } from '../../support/autoSave'

// Triggers as atoms (utils/automationTrigger.ts): a subject, a moment of it and
// a timing, chosen in the builder and saved beside the old trigger name the
// code before them reads; a rule saved on an old trigger opening as its atom;
// and the engine running moments no old trigger had -- a patient added, a
// timing in minutes after an appointment starts, an event held back.
//
// Every rule is in test mode with one email step, so a start is visible as the
// email it records, and its absence as none.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface EmailRow {
  dry_run: boolean
  rule_id: string | null
  subject: string | null
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Automation triggers as atoms', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  const cron = (path: string) => cy.request({ method: 'POST', url: `/api/automations/${path}`, headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
  const emailsFor = (patientId: string) => cy.task<EmailRow[]>('auto:emailsFor', { patientId })
  const patient = (extra: Record<string, unknown> = {}) =>
    cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Atomo', lastName: 'Prueba', email: `atomo.${stamp()}@example.test`, phone: randomPhone(), ...extra })
  function rule(trigger: Record<string, unknown>, filters: Record<string, unknown>, subject: string) {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'atom',
      trigger: { timing: null, options: {}, ...trigger },
      dryRun: true,
      filters,
      actions: [{ type: 'email', config: { subject, body: '<p>Hola {{first_name}}</p>' } }],
    })
  }
  const savedRule = (id: string) =>
    cy.task<{ trigger: Record<string, any>; trigger_event: string; filters: Record<string, any> }[]>('db:selectRows', { table: 'automation_rules', columns: 'trigger, trigger_event, filters', match: { id } }).then((rows) => rows[0]!)

  it('builds "24 hours before an appointment starts" and saves it as the reminder it always was', () => {
    cy.visit('/automations/new')
    cy.get('[data-test="automation-name"]').clear().type('Recordatorio atomico')
    cy.get('[data-test="trigger-subject"]').select('appointment')
    cy.get('[data-test="trigger-moment"]').select('start')
    // A start is a date: it is counted before or after, never "as it happens".
    cy.get('[data-test="trigger-timing-now"]').should('not.exist')
    cy.get('[data-test="trigger-amount"]').should('have.value', '24')
    cy.get('[data-test="trigger-unit"]').should('have.value', 'hours')
    cy.get('[data-test="trigger-before"]').should('have.attr', 'aria-pressed', 'true')
    // Only booked visits, unless the clinic says otherwise.
    cy.get('[data-test="trigger-filter-appointment_status"]').should('be.visible')
    cy.get('[data-test="trigger-timing-text"]').should('contain', '24 h')

    // A step, so there is something to run; auto-saved as it is edited.
    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-delay"]').click()
    autoSaved()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.location('pathname').then((path) => {
      savedRule(path.split('/').pop()!).then((r) => {
        expect(r.trigger).to.deep.include({ subject: 'appointment', moment: 'start', timing: { amount: 24, unit: 'hours', direction: 'before' } })
        // What the code before the atoms reads, written beside it.
        expect(r.trigger_event).to.eq('appointment.hours_before')
        expect(r.filters).to.deep.include({ appointment_statuses: ['booked'], hours_before: 24 })
      })
    })

    // A moment no old trigger had is saved as one only the atoms say.
    cy.get('[data-test="node-trigger"]').click()
    cy.get('[data-test="trigger-subject"]').select('patient')
    cy.get('[data-test="trigger-moment"]').select('created')
    cy.get('[data-test="trigger-filter-appointment_status"]').should('not.exist')
    autoSaved()
    cy.location('pathname').then((path) => {
      savedRule(path.split('/').pop()!).should((r) => {
        expect(r.trigger).to.deep.include({ subject: 'patient', moment: 'created', timing: null })
        expect(r.trigger_event).to.eq('atom')
        expect(r.filters).not.to.have.property('appointment_statuses')
      })
    })
  })

  it('opens a rule saved on an old trigger as its atom', () => {
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.review_request',
      dryRun: true,
      filters: { days_after: 3 },
      actions: [{ type: 'email', config: { subject: 'Resena', body: '<p>Hola</p>' } }],
    }).then((r) => {
      cy.visit(`/automations/${r.id}`)
      cy.get('[data-test="node-trigger"]').should('contain', '3 days after it ends').click()
      cy.get('[data-test="trigger-subject"]').should('have.value', 'appointment')
      cy.get('[data-test="trigger-moment"]').should('have.value', 'end')
      cy.get('[data-test="trigger-amount"]').should('have.value', '3')
      cy.get('[data-test="trigger-unit"]').should('have.value', 'days')
      // What the old trigger decided by itself is an "only if" filter now.
      cy.get('[data-test="trigger-filter-appointment_status"]').should('be.visible')
    })
  })

  it('starts on a patient added by the team, once, and not on one an import brought', () => {
    rule({ subject: 'patient', moment: 'created' }, {}, 'Bienvenida')
    patient().then((added) => {
      patient({ externalReference: `import-${stamp()}` }).then((imported) => {
        cron('lead-sequence-cron')
        cron('lead-sequence-cron')
        emailsFor(added.id).should((rows) => {
          expect(rows.map((r) => r.subject)).to.deep.eq(['Bienvenida'])
          expect(rows.every((r) => r.dry_run)).to.eq(true)
        })
        emailsFor(imported.id).should('have.length', 0)
      })
    })
  })

  it('starts thirty minutes after an appointment starts, only for the status it names', () => {
    rule({ subject: 'appointment', moment: 'start', timing: { amount: 30, unit: 'minutes', direction: 'after' } }, { appointment_statuses: ['booked', 'completed'] }, 'Durante la cita')
    patient().then((p) => {
      patient().then((other) => {
        // Due when start + 30 min falls in [now, now + 20 min): started 25 minutes ago.
        const startedAgo = new Date(Date.now() - 25 * 60 * 1000).toISOString()
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: startedAgo })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: other.id, startsAt: startedAgo }).then((appt) => {
          cy.task('db:updateRows', { table: 'appointments', match: { id: appt.id }, values: { status: 'no_show' } })
        })
        cron('hours-before-cron')
        cron('hours-before-cron')
        emailsFor(p.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Durante la cita']))
        emailsFor(other.id).should('have.length', 0)
      })
    })
  })

  it('holds an event back by its timing, and sends nothing until then', () => {
    rule({ subject: 'appointment', moment: 'checked_in', timing: { amount: 2, unit: 'hours', direction: 'after' } }, {}, 'Dos horas despues')
    patient().then((p) => {
      cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date().toISOString() }).then((appt) => {
        cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.checked_in', patientId: p.id, appointmentId: appt.id } })
        cron('lead-sequence-cron')
        emailsFor(p.id).should('have.length', 0)
        cy.task<{ resume_at: string; status: string }[]>('db:selectRows', { table: 'automation_sequence_runs', columns: 'resume_at, status', match: { patient_id: p.id } }).should((runs) => {
          expect(runs).to.have.length(1)
          expect(runs[0]!.status).to.eq('running')
          expect(new Date(runs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now() + 100 * 60 * 1000)
        })
      })
    })
  })
})
