// A practitioner could not tell whether a patient had sessions left on their
// bono. Reading package_purchases needed billing_config or packages_edit, which
// no Practitioner role holds, so every read came back empty: the calendar said
// "0 of 0 left" and the record said nothing at all. Reading is now everyone's
// within their patient scope (staff_see_bono_progress); changing a bono is not.
describe('A practitioner and the patient\'s bono', () => {
  it('sees how many sessions are used and left, and cannot change the bono', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Berta', lastName: 'Bonoprueba' }).then((patient) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 10 sesiones', sessionsTotal: 10, sessionsUsed: 4, priceCents: 40000 })
        // Spent and closed: history, not something to follow.
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono antiguo', sessionsTotal: 5, sessionsUsed: 5, priceCents: 20000, isClosed: true })

        // The clinic this came from gives its practitioners every patient.
        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { patients_scope: 'all' } })
        const email = `prac-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
        cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password: 'Test1234!', fullName: 'Prac Bono' })
        cy.login(email, 'Test1234!')
        cy.visit(`/patients/${patient.id}`)

        cy.get('[data-cy="overview-bonos"]').within(() => {
          cy.contains('Bono 10 sesiones').should('be.visible')
          cy.get('[data-cy="overview-bono-left"]').should('have.text', '6 of 10 left')
          cy.contains('4 used').should('be.visible')
          cy.contains('Bono antiguo').should('not.exist')
        })
        // The Money tab (billing_history_view, which the seeded role has)
        // lists it too, with nothing on it that changes the bono or takes
        // money for it: those writes are still refused to this role.
        cy.visit(`/patients/${patient.id}?tab=money`)
        cy.contains('[data-cy="bono-card"]', 'Bono 10 sesiones').within(() => {
          cy.contains('6 of 10 sessions left').should('be.visible')
          cy.get('[data-cy="log-session-open"]').should('not.exist')
          cy.contains('button', 'Take payment').should('not.exist')
          cy.contains('button', 'Share').should('not.exist')
        })
      })
    })
  })
})
