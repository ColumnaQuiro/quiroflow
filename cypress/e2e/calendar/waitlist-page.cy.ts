// The Waitlist page lists who is on it. Its read embeds appointment_types,
// which waitlist_entries references twice (appointment_type_id and
// offered_appointment_type_id): a bare embed is refused as ambiguous, the
// whole select fails, and the page used to say "No one on the waitlist"
// with people waiting.
describe('Waitlist page', () => {
  it('shows the people waiting', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Montse', lastName: 'Aguilar' }).then((montse) => {
        cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: montse.id, createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })
      })
      cy.login(account.email, account.password)
      cy.visit('/waitlist')
      cy.contains('tr', 'Montse Aguilar').should('be.visible').and('contain.text', 'Waiting')
      cy.contains('No one on the waitlist').should('not.exist')
    })
  })
})
