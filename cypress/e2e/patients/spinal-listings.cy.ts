// Spinal listings beside the visit notes: tap L or R per segment, saved as
// you tap, with what was listed on the previous visit (and "same as last
// time"). Read and written under the visit notes permissions.

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}

describe('Spinal listings', () => {
  it('lists segments on a visit, and shows them on the next one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teo', lastName: 'Vega' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-7).toISOString(), status: 'completed' }).then((first) => {
          cy.task('db:insertRows', { table: 'visit_listings', rows: [{ account_id: account.accountId, appointment_id: first.id, listings: { C5: 'R', L4: 'L', Knee: 'R' } }] })
        })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(0, 9).toISOString(), status: 'completed' }).then((today) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.contains('button', 'Add note', { timeout: 20000 }).click()
          cy.get('[data-cy="listings-summary"]').should('contain', 'None yet')
          cy.get('[data-cy="listings-toggle"]').click()
          cy.get('[data-cy="listings-previous"]').should('contain', 'C5 R · L4 L · Knee R')

          // Tap T4 left, C1 both sides.
          cy.get('[data-cy="listing-T4"] [data-cy="listing-L"]').click()
          cy.get('[data-cy="listing-C1"] [data-cy="listing-L"]').click()
          cy.get('[data-cy="listing-C1"] [data-cy="listing-R"]').click()
          cy.get('[data-cy="listing-C1"] [data-cy="listing-R"]').should('have.attr', 'aria-pressed', 'true')
          cy.get('[data-cy="listings-summary"]').should('have.text', 'C1 L/R · T4 L')
          // Same as last time is only offered while nothing is listed.
          cy.get('[data-cy="listings-copy-previous"]').should('not.exist')
          cy.task<{ listings: Record<string, string> }[]>('db:selectRows', { table: 'visit_listings', columns: 'listings', match: { appointment_id: today.id } })
            .its('0.listings').should('deep.equal', { C1: 'B', T4: 'L' })

          // Untapping clears it.
          cy.get('[data-cy="listing-T4"] [data-cy="listing-L"]').click()
          cy.get('[data-cy="listings-summary"]').should('have.text', 'C1 L/R')
        })
      })
    })
  })

  it('copies the last visit with one tap', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Rius' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-3).toISOString(), status: 'completed' }).then((first) => {
          cy.task('db:insertRows', { table: 'visit_listings', rows: [{ account_id: account.accountId, appointment_id: first.id, listings: { T6: 'B', Sacrum: 'L' } }] })
        })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(0, 9).toISOString(), status: 'completed' }).then((today) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.contains('button', 'Add note', { timeout: 20000 }).click()
          cy.get('[data-cy="listings-toggle"]').click()
          cy.get('[data-cy="listings-copy-previous"]').click()
          cy.get('[data-cy="listings-summary"]').should('have.text', 'T6 L/R · Sacrum L')
          cy.task<{ listings: Record<string, string> }[]>('db:selectRows', { table: 'visit_listings', columns: 'listings', match: { appointment_id: today.id } })
            .its('0.listings').should('deep.equal', { T6: 'B', Sacrum: 'L' })
        })
      })
    })
  })
})
