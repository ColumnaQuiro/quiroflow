import { openNewAppointmentPanel, seedVisit } from '../../support/calendar'

// A note on an appointment type for the team only ("check finances", "hand
// over the VIP vouchers"). Clinics were making extra types to carry it in the
// name, which the patient sees. The note lives in its own table so that a
// patient -- who may read the types of their own visits -- never reads it.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))
const NOTE = 'Check finances and hand over the VIP vouchers'

describe('A team note on an appointment type', () => {
  it('is written in settings and shown when booking and on the visit, never to the patient', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Re-evaluation', durationMinutes: 30, defaultPriceCents: 4500 }).then((type) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-staff-note]', { timeout: 15000 }).type(NOTE)
        cy.contains('button', 'Save').click()
        cy.contains('Saved').should('be.visible')

        seedVisit(account, null, 'Nota', 'Tipo', 10, 0, { appointmentTypeId: type.id }).then(({ patientId }) => {
          // The patient of that visit can read the type, but not its note.
          const email = `nota-${Date.now()}@example.test`
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId, email, password: 'Password123!' })
          cy.task<{ rows: unknown[]; error: string | null }>('db:selectAsUser', { email, password: 'Password123!', table: 'appointment_type_staff_notes' }).its('rows').should('have.length', 0)
          cy.task<{ rows: { name: string }[] }>('db:selectAsUser', { email, password: 'Password123!', table: 'appointment_types', select: 'name' })
            .its('rows')
            .should('deep.include', { name: 'Re-evaluation' })
        })

        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.contains('[data-cy=appt-block]', 'Nota Tipo').click()
        cy.get('[data-cy=appt-sheet]').find('[data-cy=appt-panel-type-note]').should('contain.text', NOTE)
        cy.get('body').type('{esc}')

        // The sheet preselects the clinic's only type, so the note is there as
        // soon as the type is.
        openNewAppointmentPanel()
        cy.contains('[data-cy=create-type]', 'Re-evaluation').click()
        cy.get('[data-cy=create-type-note]').should('contain.text', NOTE)
      })
    })
  })
})
