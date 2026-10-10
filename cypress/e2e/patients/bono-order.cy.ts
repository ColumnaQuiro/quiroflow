// A patient's bonos list the ones in use first. A family bono shared to them
// was appended after all of their own -- so the one they were actually using
// sat at the end, below bonos they had finished long ago.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('Bono order on the record', () => {
  it('shows the bono in use first, even when it is a shared one', () => {
    cy.seedStaffAccount().then((account) => {
      const a = account.accountId
      cy.task<{ id: string }>('db:createPatient', { accountId: a, clinicId: account.clinicId, firstName: 'Elena', lastName: 'Mayor' }).then((parent) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: a, clinicId: account.clinicId, firstName: 'Pau', lastName: 'Mayor' }).then((child) => {
          // The family bono, bought two months ago, 6 sessions left, shared with Pau.
          cy.task<{ id: string }>('db:createPackagePurchase', { accountId: a, patientId: parent.id, packageName: 'Bono familiar', sessionsTotal: 10, sessionsUsed: 4 }).then((family) => {
            cy.task('db:updateRows', { table: 'package_purchases', values: { purchased_at: daysAgo(60) }, match: { id: family.id } })
            cy.task('db:sharePackageWith', { accountId: a, packagePurchaseId: family.id, patientId: child.id })
          })
          // Pau's own: one finished last week, one finished long ago.
          cy.task<{ id: string }>('db:createPackagePurchase', { accountId: a, patientId: child.id, packageName: 'Bono terminado', sessionsTotal: 5, sessionsUsed: 5 }).then((b) => {
            cy.task('db:updateRows', { table: 'package_purchases', values: { purchased_at: daysAgo(10) }, match: { id: b.id } })
          })
          cy.task<{ id: string }>('db:createPackagePurchase', { accountId: a, patientId: child.id, packageName: 'Bono antiguo', sessionsTotal: 10, sessionsUsed: 10 }).then((b) => {
            cy.task('db:updateRows', { table: 'package_purchases', values: { purchased_at: daysAgo(120) }, match: { id: b.id } })
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${child.id}?tab=money`)
          cy.get('[data-cy="bono-card"]', { timeout: 20000 }).should('have.length', 3)
          cy.get('[data-cy="bono-card"]').then((cards) => {
            expect([...cards].map((c) => c.textContent?.match(/Bono (familiar|terminado|antiguo)/)?.[0])).to.deep.equal(['Bono familiar', 'Bono terminado', 'Bono antiguo'])
          })
        })
      })
    })
  })
})
