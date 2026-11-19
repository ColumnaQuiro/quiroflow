// Paying the rest of a bono pays the sessions already drawn from it.
//
// A session drawn while the bono's money had run out is charged unpaid -- that
// is right, nothing had been paid for it yet. What was wrong is that paying
// the bono afterwards left that charge unpaid for good: the bono read paid in
// full while the patient's Overview kept asking for the money. A family bono
// paid 240 + 240 on 19 Nov 2026 left four session charges (160 EUR) open on
// three records with the family 80 EUR in credit.
// 20261119194013_bono_payment_settles_session_charges.
describe('Paying a bono after sessions were drawn on credit', () => {
  it('settles the session charges the money now covers, and only those', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paga', lastName: 'Despues' }).then((patient: any) => {
        // Three sessions at 40 EUR, 40 paid down: enough for the first.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 3',
          sessionsTotal: 3,
          sessionsUsed: 0,
          priceCents: 12000,
          owedCents: 12000,
        }).then((pkg: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4000, method: 'cash', purpose: 'bono', packagePurchaseId: pkg.id })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)
          cy.contains('[data-cy="bono-card"]', 'Bono 3').should('be.visible')

          // First session: the 40 already paid covers it.
          cy.get('[data-cy="log-session-open"]').click()
          cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
          cy.contains('2 of 3 sessions left', { timeout: 15000 }).should('be.visible')

          // Second session: nothing left to cover it, so it is owed. Today
          // already has a visit on the bono, so the dialog picks nothing for
          // itself -- record this one yesterday, "not on the calendar".
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
          cy.get('[data-cy="log-session-open"]').click()
          cy.get('[data-cy="log-session-new"]').click()
          cy.get('[data-cy="log-session-date"]').type(yesterdayStr)
          cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
          cy.contains('1 of 3 sessions left', { timeout: 15000 }).should('be.visible')

          cy.task('db:invoicesFor', { patientId: patient.id }).then((invoices: any) => {
            expect(invoices.map((i: any) => i.status), 'first covered, second owed').to.deep.eq(['paid', 'unpaid'])
          })

          // 20 EUR towards the bono is not the 40 the session costs: it stays owed.
          cy.contains('button', 'Take payment…').click()
          cy.get(`input[id$="-collectAmount-${pkg.id}"]`).clear().type('20')
          cy.contains('button', 'Record payment').click()
          cy.contains('Recording…').should('not.exist')
          cy.contains('60,00 € owed').scrollIntoView().should('be.visible')

          cy.task('db:invoicesFor', { patientId: patient.id }).then((invoices: any) => {
            expect(invoices.map((i: any) => i.status), 'part of a session pays none of it').to.deep.eq(['paid', 'unpaid'])
          })

          // The rest of the bono: the drawn session is paid for now.
          cy.contains('button', 'Take payment…').click()
          cy.contains('button', 'Record payment').click()
          cy.contains('Recording…').should('not.exist')
          cy.contains('120,00 € paid in full').scrollIntoView().should('be.visible')

          cy.task('db:invoicesFor', { patientId: patient.id }).then((invoices: any) => {
            expect(invoices.map((i: any) => i.status), 'the bono paid in full pays its drawn sessions').to.deep.eq(['paid', 'paid'])
          })

          // And the Overview stops asking for it, which is where it was seen.
          // "Nothing booked." only renders once the overview has loaded.
          cy.visit(`/patients/${patient.id}`)
          cy.contains('Nothing booked.', { timeout: 15000 }).should('be.visible')
          cy.contains('Needs attention').should('not.exist')
        })
      })
    })
  })
})
