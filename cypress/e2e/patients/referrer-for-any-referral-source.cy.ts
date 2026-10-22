import type { StaffAccount } from '../../support/commands'

// "Referred by (existing patient)" used to appear only when the referral
// source was the exact text "Patient". A clinic with a "Referral" source
// picked it and had no way to say who sent the patient.
describe('Referred by, for any referral source', () => {
  it('asks who referred them when the source is "Referral", and keeps it', () => {
    cy.seedStaffAccount().then((account: StaffAccount) => {
      cy.task('db:createReferralSource', { accountId: account.accountId, name: 'Referral' })
      cy.task('db:createReferralSource', { accountId: account.accountId, name: 'Instagram' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Quien', lastName: 'Recomienda' }).then((referrer) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nueva', lastName: 'Paciente' }).then((patient) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)
          cy.contains('button', 'Edit all details', { timeout: 15000 }).click()

          cy.get('[data-cy=referral-source-select]').scrollIntoView().select('Instagram')
          cy.get('[data-cy=referred-by-picker]').should('not.exist')

          cy.get('[data-cy=referral-source-select]').select('Referral')
          cy.get('[data-cy=referred-by-search]').should('be.visible').type('Quien')
          cy.get('[data-cy=referred-by-picker]').contains('button', 'Quien Recomienda').click()
          cy.contains('button', /^Save$/).click()
          cy.contains('Patient saved').should('be.visible')

          cy.task<{ referred_by_patient_id: string | null }>('db:patientMergeFields', { patientId: patient.id }).its('referred_by_patient_id').should('eq', referrer.id)
        })
      })
    })
  })
})
