// How a care plan is paid, linked to what the clinic already sells: a bono
// (and whether it covers the visits left) or a membership. Nothing is charged
// from the plan; the bono and the membership keep their own money.

describe('Care plan payment', () => {
  it('is paid from a bono, and says whether the bono covers the plan', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Noa', lastName: 'Ferrer' }).then((patient) => {
        cy.task<{ id: string }>('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 10', sessionsTotal: 10, sessionsUsed: 4 }).then((bono) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy="care-plan-edit"]', { timeout: 20000 }).click()
          cy.get('input[type="number"]').last().clear().type('8') // total visits
          cy.get('[data-cy="plan-pay-bono-select"]').should('not.exist')
          cy.contains('[data-cy="plan-payment"] button', 'Bono').click()
          cy.get('[data-cy="plan-pay-bono-select"]').select('Bono 10 · 6 left')
          cy.contains('button', 'Save').click()
          cy.get('[data-cy="plan-payment-line"]').should('contain', 'bono «Bono 10»').and('contain', '6 left')
          cy.get('[data-cy="plan-payment-coverage"]').should('contain', 'covers 6 of the 8 visits left')
          cy.task<{ payment_kind: string; package_purchase_id: string | null }[]>('db:selectRows', { table: 'care_plans', columns: 'payment_kind, package_purchase_id', match: { patient_id: patient.id } })
            .its('0').should('deep.equal', { payment_kind: 'bono', package_purchase_id: bono.id })
        })
      })
    })
  })

  it('is paid under a membership', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iker', lastName: 'Sala' }).then((patient) => {
        cy.task('db:insertRows', { table: 'patient_memberships', rows: [{ account_id: account.accountId, patient_id: patient.id, membership_name: 'Plan mensual', price_cents: 6000, status: 'active', billing_interval: 'month', billing_interval_count: 1 }] })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-edit"]', { timeout: 20000 }).click()
        cy.contains('[data-cy="plan-payment"] button', 'Membership').click()
        cy.contains('button', 'Save').click()
        cy.contains('Choose the membership that pays for it.').should('be.visible')
        cy.get('[data-cy="plan-pay-membership-select"] option').contains('Plan mensual').then((o) => cy.get('[data-cy="plan-pay-membership-select"]').select(o.val() as string))
        cy.contains('button', 'Save').click()
        cy.get('[data-cy="plan-payment-line"]').should('contain', 'membership «Plan mensual»').and('contain', '60,00').and('contain', '/ month')
      })
    })
  })
})
