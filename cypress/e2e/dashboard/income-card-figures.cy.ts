// The dashboard's income card, filtered to one practitioner.
//
// Jordana Aguar's first month read "€2320.00, -56% vs previous period" — her
// September against the WHOLE CLINIC's late August, because the
// previous-period total was summed account-wide while the figure above it was
// filtered. She had gone from nothing to 2,320 and the card called it a 56%
// collapse.
//
// "Last 30 days" rather than the default "this month": that preset's previous
// window is the 30 days before it, whatever the date. On the 1st of a month
// the default range is a few hours long and its previous window is too, so a
// seeded payment lands outside both and the test passes without testing
// anything.
describe('The dashboard income card', () => {
  it('compares a practitioner against their own previous period, not the clinic', () => {
    cy.seedStaffAccount().then((account) => {
      // The seeded plan covers one practitioner and the owner holds that seat.
      cy.setExtraProfessionals(account.accountId, 1)
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `nueva-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Nueva Nadia',
        isPractitioner: true,
      }).then((nadia: any) => {
        const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

        // Nadia's only money, inside the current window. No appointment and no
        // invoice behind it -- a bono or money on account -- so it is placed by
        // the patient's own practitioner, which is the common case here.
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Paula',
          lastName: 'Primera',
          defaultPractitionerId: nadia.teamMemberId,
        }).then((patient: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            amountCents: 232000,
            method: 'card',
            paidAt: daysAgo(3),
          })
        })

        // Somebody else's money, in the PREVIOUS window. This is what the card
        // used to divide by.
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Otro',
          lastName: 'Practicante',
          defaultPractitionerId: account.teamMemberId,
        }).then((patient: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            amountCents: 527800,
            method: 'card',
            paidAt: daysAgo(40),
          })
        })

        cy.login(account.email, account.password)
        cy.visit('/dashboard')

        // clickUntil, not click: the dashboard's HTML (this button included)
        // is server-rendered and present long before Vue hydrates, so the
        // first click can land on a button nothing is listening to yet and
        // vanish. The panel then never opens and the failure reads as
        // "Expected to find content: 'Last 30 days'", which sounds like the
        // preset is missing rather than like a click that went nowhere.
        // See clickUntil in cypress/support/commands.ts.
        cy.clickUntil('button:contains("month"), button:contains("days")', 'button:contains("Last 7 days")')
        cy.contains('Last 30 days').click()
        cy.get('select').first().select('Nueva Nadia')

        // Her own takings, and nothing else's.
        cy.contains('€2320.00').should('be.visible')
        // No comparison at all: she has no previous period. It used to read
        // "-56% vs previous period", measured against the 5,278 above.
        cy.contains('vs previous period').should('not.exist')
      })
    })
  })

  it("reports what is unpaid on the period's invoices, never a negative", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruna', lastName: 'Bono' }).then((patient: any) => {
        // A bono: EUR 528 collected against no invoice at all, which is most
        // of what this clinic takes. Plus one EUR 44 visit, half paid.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 52800, method: 'card' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((invoice: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 2200, method: 'cash' })

          cy.login(account.email, account.password)
          cy.visit('/dashboard')

          // Charged 44, collected 550. The old arithmetic was charged minus
          // collected, so it showed "Outstanding -506.00" -- a debt owed
          // backwards. What is actually unpaid is the other half of the visit.
          cy.contains('€22.00').should('be.visible')
          cy.contains('€-506.00').should('not.exist')
        })
      })
    })
  })
})
