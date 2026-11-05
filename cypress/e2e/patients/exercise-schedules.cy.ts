// Exercises by visit (the exercise_schedules migration): a clinic builds a
// schedule in Settings > Exercise Library, a practitioner sets it up on a
// patient's record, and each step reaches the patient as they attend its
// visit -- a step already reached at once on save, the next one from the
// same-day cron after the visits are completed.

const runCron = () => cy.request({ method: 'POST', url: '/api/automations/same-day-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('Exercise schedules by visit', () => {
  it('builds a schedule, gives the step reached on save, and the next one when its visit is attended', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createExercises', { accountId: account.accountId, names: ['Gato-camello', 'Puente de glúteo'] })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Vidal' }).then((patient) => {
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 12, startedAt: daysAgo(20).slice(0, 10) })
        // Visit 1 has already happened.
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, startsAt: daysAgo(10), status: 'completed' })

        cy.login(account.email, account.password)

        // The clinic's template: visit 1 one exercise, visit 3 another instead.
        cy.visit('/settings/exercises')
        cy.get('[data-cy="schedule-new"]').click()
        cy.get('[data-cy="schedule-name"]').type('Lumbalgia por fases')
        cy.get('[data-cy="schedule-step"]').eq(0).within(() => {
          cy.get('[data-cy="schedule-step-label"]').type('Semana 1')
          cy.get('[data-cy="schedule-item-exercise"]').select('Gato-camello')
        })
        cy.get('[data-cy="schedule-step-add"]').click()
        cy.get('[data-cy="schedule-step"]').eq(1).within(() => {
          cy.get('[data-cy="schedule-step-visit"]').clear().type('3')
          cy.get('[data-cy="schedule-item-exercise"]').select('Puente de glúteo')
        })
        cy.get('[data-cy="schedule-save"]').click()
        cy.get('[data-cy="schedule-row"]').should('have.length', 1).and('contain.text', 'Lumbalgia por fases').and('contain.text', 'From visit 3')

        // On the record: visit 1 is already behind them, so its step is given now.
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="patient-schedule-new"]').click()
        cy.get('[data-cy="patient-schedule-template"]').select('Lumbalgia por fases')
        cy.get('[data-cy="patient-schedule-save"]').click()
        cy.get('[data-cy="patient-schedule-notice"]').should('contain.text', '1 exercise given now')
        cy.get('[data-cy="exercise-row"]').should('have.length', 1).and('contain.text', 'Gato-camello')
        cy.get('[data-cy="exercise-row-scheduled"]').should('exist')
        cy.get('[data-cy="patient-schedule-visits"]').should('contain.text', '1 visit since').and('contain.text', 'next step at visit 3')

        // Two more visits, one completed and one checked in: the cron gives step 2, which replaces step 1.
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, startsAt: daysAgo(5), status: 'completed' })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, startsAt: daysAgo(0), checkedIn: true })
        runCron()
        cy.reload()
        cy.get('[data-cy="exercise-row"]').should('have.length', 1).and('contain.text', 'Puente de glúteo')
        cy.get('[data-cy="patient-schedule-visits"]').should('contain.text', '3 visits since').and('contain.text', 'every step given')
        cy.get('[data-cy="patient-schedule-step"]').should('have.length', 2)
      })
    })
  })
})
