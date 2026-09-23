// A bono PracticeHub has closed keeps whatever sessions were on its counter.
// The packages importer brings it in that way on purpose -- a spent bono is
// deactivated there, and dropping it left a patient's visits with nothing that
// paid for them -- but for a long time nothing recorded that it was closed, so
// every screen that asks "what can this patient use?" answered by comparing
// sessions_used against sessions_total and offered it.
//
// Paqui Cortes is the case: a 480 EUR Bono mantenimiento bought on 12 Aug with
// one session taken, deactivated in PracticeHub and re-issued on 9 Sep at the
// same price. PracticeHub shows her one live bono. QuiroFlow showed two, and
// counted 440 EUR of the closed one as money she could draw on.
describe('A bono closed in PracticeHub', () => {
  it('is not counted as money and cannot be drawn on, but is still listed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paqui', lastName: 'Closedbono' }).then((patient: any) => {
        // The August bono: closed in PracticeHub, eleven of twelve sessions
        // still on its counter -- 440 EUR if anyone counted them.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono agosto',
          sessionsTotal: 12,
          sessionsUsed: 1,
          priceCents: 48000,
          isClosed: true,
        })
        // The September one that replaced it: live, ten sessions left, 400 EUR.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono septiembre',
          sessionsTotal: 12,
          sessionsUsed: 2,
          priceCents: 48000,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Only the live bono is money. 840 is the figure this used to show.
        //
        // \u00a0 because money() formats through Intl, which puts a
        // non-breaking space before the euro sign -- an ordinary space here
        // matches nothing and the assertion times out. The pill below goes
        // through formatEur, which uses a plain one.
        cy.contains('dt', 'In bonos').parent().should('contain', '400,00\u00a0€')
        cy.contains('400,00 € available').should('be.visible')
        cy.contains('840,00 € available').should('not.exist')

        // Still on screen, and saying what it is -- a bono that silently
        // disappears is harder to explain than one marked closed.
        cy.contains('Bono agosto').should('be.visible')
        cy.contains('[data-cy="bono-card"]', 'Bono agosto').within(() => {
          cy.contains('Closed').should('be.visible')
          cy.contains('button', 'Log session').should('be.disabled')
        })

        // The live one is untouched by any of this.
        cy.contains('[data-cy="bono-card"]', 'Bono septiembre').within(() => {
          cy.contains('10 of 12 sessions left').should('be.visible')
          cy.contains('button', 'Log session').should('not.be.disabled')
        })
      })
    })
  })

  it('is not the bono the calendar offers for a visit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cierre', lastName: 'Solobono' }).then((patient: any) => {
        // Her only bono is a closed one with sessions left on it. Nothing
        // should offer to draw a session from it.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono cerrado',
          sessionsTotal: 12,
          sessionsUsed: 1,
          priceCents: 48000,
          isClosed: true,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Nothing to draw on: the bono figure reads zero rather than the 440
        // EUR still sitting on the counter, and the bono's own button is
        // disabled rather than offering its eleven remaining sessions.
        cy.contains('Bono cerrado').should('be.visible')
        cy.contains('dt', 'In bonos').parent().should('contain', '0,00\u00a0€')
        cy.contains('440,00\u00a0€').should('not.exist')
        cy.contains('button', 'Log session').should('be.disabled')
      })
    })
  })
})
