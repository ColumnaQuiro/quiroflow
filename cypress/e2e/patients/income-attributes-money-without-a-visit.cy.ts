// Income filtered by practitioner could only see money from visits.
//
// The chain was payment -> invoice -> appointment -> practitioner, and
// anything off it belonged to nobody. Filtering September by Beatriz Ferrando
// showed €849 while the clinic had taken €9,976 — the other €9,057 was bono
// payments, money on account and quick invoices, none of which has an
// appointment behind it, so all of it silently vanished from every
// practitioner's figure.
//
// Now the patient's own practitioner answers when the visit cannot.
describe('Income filtered by practitioner', () => {
  it('counts a bono payment through the patient, not just visits', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Bono',
        lastName: 'Sinvisita',
        defaultPractitionerId: account.teamMemberId,
      }).then((patient: any) => {
        // €200 on account: a payment with no invoice and so no appointment —
        // exactly the shape that used to be invisible.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 20000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        // Unfiltered it was always counted.
        cy.contains('200,00 €').should('be.visible')

        // Filtered to the practitioner it now still is, via the patient.
        cy.contains('select', 'All practitioners').select('Test Owner')
        cy.contains('200,00 €').should('be.visible')
      })
    })
  })

  it('names what it cannot attribute instead of dropping it', () => {
    cy.seedStaffAccount().then((account) => {
      // No practitioner on the patient, no appointment on the money: nothing
      // says whose this is. Claiming it belongs to nobody is right; hiding it
      // is what made the totals stop reconciling.
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nadie', lastName: 'Atribuible' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 7500, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')
        cy.contains('no filter can attribute').should('not.exist')

        cy.contains('select', 'All practitioners').select('Test Owner')
        cy.contains('75,00 €').should('be.visible')
        cy.contains('no filter can attribute').should('be.visible')
      })
    })
  })

  // The filter was taught the patient fallback; the "By practitioner"
  // breakdown on the same page was not, and kept reading
  // payment -> invoice -> appointment alone. Worse, the appointments and
  // patients it reads were only fetched WHEN A FILTER WAS SET, on the
  // reasoning that unfiltered they were "fetched and never read" -- so with
  // no filter, which is how the page opens, the breakdown had nothing to
  // attribute with and put the whole month under "Sin asignar".
  it('attributes the same money in the breakdown as in the filter, with no filter set', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Bono',
        lastName: 'Desglose',
        defaultPractitionerId: account.teamMemberId,
      }).then((patient: any) => {
        // €300 with no invoice and so no appointment -- a bono or money on
        // account, the shape the breakdown could not place.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 30000, method: 'card', purpose: 'bono' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        // Nothing touched: no practitioner picked, no date range changed.
        cy.contains('h3', 'By practitioner')
          .parent()
          .within(() => {
            // Without the euro sign: formatEur is es-ES and puts U+00A0
            // before it, which contain.text does not normalise -- see the
            // note in credit-is-not-income-twice.cy.ts.
            cy.contains('li', 'Test Owner').should('contain.text', '300,00')
            cy.contains('li', 'Unassigned').should('not.exist')
          })
      })
    })
  })

  it('still calls unplaceable money unassigned in the breakdown', () => {
    // The fallback is an attribution, not an invention. A patient with no
    // practitioner of their own leaves the money genuinely unplaced, and a
    // breakdown that quietly assigned it to somebody would be worse than one
    // that could not place it at all.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sin', lastName: 'Profesional' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4000, method: 'cash', purpose: 'bono' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        cy.contains('h3', 'By practitioner')
          .parent()
          .within(() => {
            cy.contains('li', 'Unassigned').should('contain.text', '40,00')
          })
      })
    })
  })
})
