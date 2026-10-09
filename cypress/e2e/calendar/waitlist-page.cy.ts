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

  // A patient can now join from the app or the portal (join_my_waitlist). The
  // front desk sees those beside its own and has to be able to tell them
  // apart: it did not add that person, and may want to call them.
  it("marks the people who joined it themselves", () => {
    const email = `waitlist-self-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rocío', lastName: 'Gil' }).then((self) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: self.id, email, password })
        cy.task<{ error: string | null }>('db:callRpcAsPatient', { email, password, fn: 'join_my_waitlist', args: { p_clinic_id: account.clinicId } }).its('error').should('be.null')
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nuria', lastName: 'Sanz' }).then((byDesk) => {
        cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: byDesk.id })
      })
      cy.login(account.email, account.password)
      cy.visit('/waitlist')
      cy.contains('tr', 'Rocío Gil').find('[data-cy="waitlist-self-added"]').should('contain.text', 'Joined themselves')
      cy.contains('tr', 'Nuria Sanz').find('[data-cy="waitlist-self-added"]').should('not.exist')
    })
  })
})
