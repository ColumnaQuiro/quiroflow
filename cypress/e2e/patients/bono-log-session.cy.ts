describe('Logging a bono session', () => {
  it('records a completed visit billed at the bono rate, and draws the credit down', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Bonos' }).then((patient: any) => {
        // 12 sessions at €528 => €44 a session, the rate the visit should be
        // billed at (not any appointment type's walk-in price).
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
          cy.contains('0/12 used').should('be.visible')

          // Logging a session now writes real records, so it asks first.
          cy.on('window:confirm', () => true)
          cy.contains('button', 'Log session').click()

          // The counter is the visible half of the change...
          cy.contains('1/12 used', { timeout: 15000 }).should('be.visible')

          // ...and this is the half that used to be missing entirely: a
          // completed visit, an invoice at the per-session rate, a payment
          // against it, and the matching credit debit.
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'sessions used').to.eq(1)

            expect(eff.appointments, 'one appointment created').to.have.length(1)
            expect(eff.appointments[0].status, 'appointment status').to.eq('completed')

            expect(eff.invoices, 'one invoice created').to.have.length(1)
            expect(eff.invoices[0].total_cents, 'invoiced at the bono rate').to.eq(4400)
            expect(eff.invoices[0].status, 'invoice status').to.eq('paid')
            expect(eff.invoices[0].appointment_id, 'invoice linked to the visit').to.eq(eff.appointments[0].id)

            expect(eff.payments, 'one payment recorded').to.have.length(1)
            expect(eff.payments[0].amount_cents, 'payment amount').to.eq(4400)
            expect(eff.payments[0].method, 'paid from credit').to.eq('credit')

            const sessionDebits = eff.credits.filter((c: any) => c.amount_cents === -4400)
            expect(sessionDebits, 'credit drawn down by the session').to.have.length(1)
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

          cy.contains('5/5 used').should('be.visible')
          cy.contains('button', 'Log session').should('be.disabled')
        })
      })
    })
  })
})
