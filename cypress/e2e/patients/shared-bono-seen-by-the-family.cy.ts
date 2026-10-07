// A bono shared with a family member, from that family member's side.
//
// package_purchase_shares has only a staff policy and the bono belongs to
// someone else, so the patient it was shared with read nothing: the app and
// the portal said "no active bono" while the clinic drew their visits from
// it. get_my_shared_packages answers for the patient themselves, and only
// for them.
describe('A bono shared with a family member', () => {
  it('is seen by that family member, and by nobody else', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      const mk = (firstName: string, lastName: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
      mk('Padre', 'Comparte').then((owner) => {
        mk('Hija', 'Recibe').then((child) => {
          mk('Otra', 'Paciente').then((stranger) => {
            cy.task<{ id: string }>('db:createPackagePurchase', { accountId: account.accountId, patientId: owner.id, packageName: 'Bono 10', sessionsTotal: 10, sessionsUsed: 4, priceCents: 40000, owedCents: 0 }).then((pkg) => {
              cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: pkg.id, patientId: child.id })
              const childLogin = { email: `shared-child-${stamp}@example.test`, password: 'valencia2026' }
              const strangerLogin = { email: `shared-stranger-${stamp}@example.test`, password: 'valencia2026' }
              cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: child.id, ...childLogin })
              cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: stranger.id, ...strangerLogin })

              cy.task<{ data: { package_name: string; sessions_used: number; owner_first_name: string }[] | null; error: string | null }>('db:callRpcAs', { ...childLogin, fn: 'get_my_shared_packages', args: { p_patient_id: child.id } }).then(({ data, error }) => {
                expect(error).to.equal(null)
                expect(data).to.have.length(1)
                expect(data![0]).to.include({ package_name: 'Bono 10', sessions_used: 4, owner_first_name: 'Padre' })
              })
              // Someone else asking about her gets nothing.
              cy.task<{ data: unknown[] | null }>('db:callRpcAs', { ...strangerLogin, fn: 'get_my_shared_packages', args: { p_patient_id: child.id } }).its('data').should('have.length', 0)

              // And the portal shows it, with who shares it.
              cy.login(childLogin.email, childLogin.password)
              cy.visit('/portal/billing')
              cy.contains('Bono 10').should('be.visible')
              cy.contains('Padre').should('be.visible')
            })
          })
        })
      })
    })
  })
})
