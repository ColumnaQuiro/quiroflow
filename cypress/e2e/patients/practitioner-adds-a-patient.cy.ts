import type { StaffAccount } from '../../support/commands'

// "New patient" on the Patients page failed for anyone on the Practitioner
// role. The form inserted the patient and asked for its id back in the same
// statement; a practitioner sees only their own patients, and a patient with
// no default practitioner is nobody's -- so the row they had just created was
// invisible to them, and the insert came back as a row-level-security error.
// The calendar's own "new patient" never had the problem because it sets the
// visit's practitioner as the default. Now the form does the equivalent: for
// someone who sees only their own patients, the patient they add is theirs.

describe('A practitioner adding a patient', () => {
  it('creates the patient, with their phone number, as one of their own', () => {
    cy.seedStaffAccount().then((account: StaffAccount) => {
      const email = `prac-add-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Pra Ctitioner',
      }).then((prac) => {
        cy.login(email, 'Test1234!')
        cy.visit('/patients')
        cy.clickUntil('button:contains("New patient")', '#first-name')

        cy.get('#first-name').type('Nueva')
        cy.get('#last-name').type('Propia')
        cy.get('input[type="tel"]').type('600123987')
        cy.contains('button', 'Add Patient').click()

        cy.location('pathname', { timeout: 15000 }).should('match', /^\/patients\/[0-9a-f-]+$/)
        cy.contains('Nueva Propia').should('be.visible')

        cy.location('pathname').then((path) => {
          const id = path.split('/').pop()!
          cy.task<{ default_practitioner_id: string | null }[]>('db:selectRows', { table: 'patients', columns: 'default_practitioner_id', match: { id } }).then((rows) => {
            expect(rows[0].default_practitioner_id).to.eq(prac.teamMemberId)
          })
          cy.task<{ numbers: { number: string }[] }>('db:patientWithContacts', { id }).then((r) => {
            expect(r.numbers.map((n) => n.number)).to.deep.equal(['600123987'])
          })
        })
      })
    })
  })
})
