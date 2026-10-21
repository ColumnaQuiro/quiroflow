// "Anular citas futuras", from a patient's "More actions" menu
// (components/patients/CancelFutureAppointmentsModal.vue): every visit ahead
// of them, listed and ticked, cancelled in one go. A past visit is not
// touched, one unticked visit is kept, and "let the patient know" fires the
// clinic's appointment-cancelled automation once, for the soonest visit.
describe('Cancelling all future appointments', () => {
  it('cancels the visits ahead that are ticked, and tells the patient once', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teo', lastName: 'Baja' }).then((patient) => {
        const day = 86_400_000
        const book = (offsetDays: number) =>
          cy.task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: new Date(Date.now() + offsetDays * day).toISOString(),
          })
        cy.task('db:insertRows', {
          table: 'automation_rules',
          rows: [{ account_id: account.accountId, name: 'Cita cancelada', trigger_event: 'appointment.cancelled', enabled: true, entry_mode: 'every_time' }],
        })
        book(-3).then((past) =>
          book(2).then((soonest) =>
            book(9).then((next) =>
              book(16).then((kept) => {
                cy.intercept('POST', '/api/automations/fire', { ok: true }).as('fire')
                cy.login(account.email, account.password)
                cy.visit(`/patients/${patient.id}`)
                cy.get('[aria-label="More actions"]').click()
                cy.get('[data-cy=patient-cancel-future]').click()

                cy.get('[data-cy=cancel-future-row]').should('have.length', 3)
                cy.get('[data-cy=cancel-future-row]').last().find('input').uncheck()
                cy.get('[data-cy=cancel-future-notify]').check()
                cy.get('[data-cy=cancel-future-confirm]').should('have.text', 'Cancel 2 appointments').click()
                cy.contains('2 appointments cancelled').should('be.visible')
                cy.wait('@fire').its('request.body').should('deep.include', { triggerEvent: 'appointment.cancelled', patientId: patient.id, appointmentId: soonest.id })

                const statusOf = (id: string) => cy.task<any[]>('db:selectRows', { table: 'appointments', columns: 'status', match: { id } }).its('0.status')
                statusOf(soonest.id).should('eq', 'cancelled')
                statusOf(next.id).should('eq', 'cancelled')
                statusOf(kept.id).should('not.eq', 'cancelled')
                statusOf(past.id).should('not.eq', 'cancelled')
                cy.get('@fire.all').should('have.length', 1)
              }),
            ),
          ),
        )
      })
    })
  })

  it('says so when there is nothing ahead', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Uma', lastName: 'Baja' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.get('[aria-label="More actions"]').click()
        cy.get('[data-cy=patient-cancel-future]').click()
        cy.get('[data-cy=cancel-future-none]').should('contain', 'Uma has no appointments ahead')
        cy.get('[data-cy=cancel-future-confirm]').should('not.exist')
      })
    })
  })
})
