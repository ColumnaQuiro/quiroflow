describe('Logging a bono session', () => {
  it('records a completed visit against the bono, and bills nothing for it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Bonos' }).then((patient: any) => {
        // 12 sessions at €528 => €44 a session. That is what the visit is
        // WORTH against the bono -- it is recorded, not charged.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('Bono 12').should('be.visible')
          cy.contains('12/12 left').should('be.visible')

          // Logging a session now writes real records, so it asks first.
          cy.on('window:confirm', () => true)
          cy.contains('button', 'Log session').click()

          // The counter is the visible half of the change...
          cy.contains('11/12 left', { timeout: 15000 }).should('be.visible')

          // ...and this is the rest of it: the visit exists as a completed
          // appointment and a package_sessions row, and NOTHING is billed.
          // The patient paid for this visit when they bought the bono, so an
          // invoice here would charge them a second time for it -- which is
          // exactly what this used to do.
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'sessions used').to.eq(1)

            expect(eff.appointments, 'one appointment created').to.have.length(1)
            expect(eff.appointments[0].status, 'appointment status').to.eq('completed')

            expect(eff.sessions, 'the visit recorded on the bono').to.have.length(1)
            expect(eff.sessions[0].amount_cents, 'worth the bono rate').to.eq(4400)
            expect(eff.sessions[0].package_purchase_id, 'against this bono').to.eq(purchase.id)
            expect(eff.sessions[0].appointment_id, 'linked to the visit').to.eq(eff.appointments[0].id)

            expect(eff.invoices, 'no invoice raised for a covered visit').to.have.length(0)
            expect(eff.payments, 'no payment recorded').to.have.length(0)
            expect(eff.credits, 'no account credit written either way').to.have.length(0)
          })
        })
      })
    })
  })

  it('does not let a bono go past its session count', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fina', lastName: 'Finished' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 5',
          sessionsTotal: 5,
          sessionsUsed: 5,
          priceCents: 22000,
        }).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('0/5 left').should('be.visible')
          cy.contains('button', 'Log session').should('be.disabled')
        })
      })
    })
  })
})
