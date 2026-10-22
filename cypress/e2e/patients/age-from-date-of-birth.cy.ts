// The patient's age, worked out from the date of birth (utils/patientAge.ts):
// shown live as the date is typed, in the details and the banner, and used to
// suggest the "under age" box when the two disagree -- suggested, not ticked,
// because ticking it stops every message to the patient.
const bornYearsAgo = (years: number) => `${new Date().getFullYear() - years}-01-01`

describe('Age from the date of birth', () => {
  it('shows the age as the date is typed, and offers to mark a minor', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Alba', lastName: 'Edad' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Edit all details').click()

        cy.get('input[type=date]').first().type(bornYearsAgo(15), { scrollBehavior: 'center' })
        cy.get('[data-cy=patient-age]').should('have.text', '15 years old')
        cy.get('[data-cy=patient-age-minor-hint]').should('contain', '15 years old').contains('button', 'Mark as under age').click({ scrollBehavior: 'center' })
        cy.get('[data-cy=patient-age-minor-hint]').should('not.exist')
        cy.contains('button', 'Save').click({ scrollBehavior: 'center' })
        cy.contains('Patient saved').should('be.visible')

        cy.task<any[]>('db:selectRows', { table: 'patients', columns: 'date_of_birth, is_minor', match: { id: patient.id } })
          .its(0)
          .should('deep.equal', { date_of_birth: bornYearsAgo(15), is_minor: true })
        cy.reload()
        cy.contains('15 years old').should('be.visible')
      })
    })
  })

  it('says when someone marked as a minor is an adult by their date of birth', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Edad' }).then((patient) => {
        cy.task('db:updateRows', { table: 'patients', values: { is_minor: true, date_of_birth: bornYearsAgo(19) }, match: { id: patient.id } })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Edit all details').click()
        cy.get('[data-cy=patient-age-adult-hint]').should('contain', 'no longer under age')
      })
    })
  })
})
