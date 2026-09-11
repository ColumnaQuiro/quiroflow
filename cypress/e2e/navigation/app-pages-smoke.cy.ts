import { APP_PAGES, sweepAuthenticatedPages } from '../../support/pageInventory'

// One of two authenticated sweeps -- this one covers everything outside
// /settings, plus the dynamic detail pages, which need real fixtures and so
// can only run where a patient and invoice have been seeded.
describe('Every authenticated app page renders for the account owner', () => {
  it('smoke-tests the app pages plus dynamic patient/billing/role detail pages', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Smoke',
        lastName: 'Test',
      }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id }).then((invoice: any) => {
          cy.login(account.email, account.password)

          sweepAuthenticatedPages(APP_PAGES)

          cy.visit(`/patients/${patient.id}`)
          cy.location('pathname').should('eq', `/patients/${patient.id}`)
          cy.contains('Smoke Test').should('be.visible')

          cy.visit(`/billing/${invoice.id}`)
          cy.location('pathname').should('eq', `/billing/${invoice.id}`)

          const practitionerRole = account.roles.find((r) => r.name === 'Practitioner')!
          cy.visit(`/settings/roles/${practitionerRole.id}`)
          cy.location('pathname').should('eq', `/settings/roles/${practitionerRole.id}`)
          cy.contains('Role name').should('be.visible')
        })
      })
    })
  })
})
