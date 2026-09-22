// The patient list's toolbar.
//
// The list has always been able to filter; what it could not do was say that
// it was filtering. A chip and a dropdown left no trace once they scrolled
// out of the toolbar, so "where did everyone go" and "this clinic has four
// patients" looked identical, and the usual remedy -- reload -- threw away
// the search along with the filter. The active-filter row is the fix, and it
// has to be able to undo one filter without undoing the rest.
describe('Filtering the patient list', () => {
  it('names each active filter and removes them one at a time', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Marisol',
        lastName: 'Mayor',
        phone: '600111222',
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')

      // Nothing is filtered by default beyond the implicit "active", which is
      // not worth a chip -- so the row is absent, not empty.
      cy.contains('Marisol Mayor').should('be.visible')
      cy.contains('button', 'Clear all').should('not.exist')

      cy.get('input[type="search"]').type('Marisol')
      cy.contains('button', 'Do not contact').click()

      // Both filters are named, and the count reflects them.
      cy.contains('"Marisol"').should('be.visible')
      cy.contains('span', 'Do not contact').should('be.visible')

      // Removing one leaves the other alone. This is the part a reload cannot
      // do, and the reason the row exists.
      cy.get('button[aria-label*="Remove filter"]').first().click()
      cy.contains('"Marisol"').should('not.exist')
      cy.contains('span', 'Do not contact').should('be.visible')

      cy.contains('button', 'Clear all').click()
      cy.contains('button', 'Clear all').should('not.exist')
      cy.contains('Marisol Mayor').should('be.visible')
    })
  })

  it('says a patient has no phone rather than leaving the cell blank', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paca', lastName: 'Sinnumero' })
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Tomas',
        lastName: 'Contelefono',
        phone: '600333444',
        invoiceEmailEnabled: true,
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')

      // An empty cell reads as "not loaded yet". This is the reason a
      // reminder will never reach them, so it is stated.
      cy.contains('tr', 'Paca Sinnumero').should('contain.text', 'No phone')
      cy.contains('tr', 'Tomas Contelefono').should('contain.text', '600')

      // Whether invoices go out by email is the other half of "can we reach
      // this person", and it rides in the same cell. It was briefly lost when
      // the separate Comms column went away.
      cy.contains('tr', 'Tomas Contelefono').should('contain.text', 'Email')
    })
  })

  it('keeps the balance column on screen at 1440, without horizontal scrolling', () => {
    // The balance is the column the front desk actually looks at, and the
    // table is wide enough that it was the first thing to fall off the right
    // edge -- at 1440, which is the width most of them run. Tags give way on
    // a narrow screen instead; this pins the trade-off so a future column
    // cannot quietly undo it.
    cy.viewport(1440, 900)
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Blanca', lastName: 'Balance' }).then(
        (patient: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

          cy.login(account.email, account.password)
          cy.visit('/patients')

          cy.contains('tr', 'Blanca Balance').should('be.visible')
          cy.contains('th', 'Balance').should('be.visible')
          cy.contains('tr', 'Blanca Balance').contains('44,00').should('be.visible')

          // And the table is not merely scrollable to it -- it fits.
          cy.get('table').parent().then(($scroller) => {
            const el = $scroller[0]
            expect(el.scrollWidth, 'table fits its container at 1440').to.be.at.most(el.clientWidth)
          })
        },
      )
    })
  })

  it('finds a patient by their national ID, not just name or phone', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dolores', lastName: 'Documento' }).then(
        (patient: any) => {
          cy.task('db:setPatientNif', { patientId: patient.id, nationalId: '12345678Z' })
          cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Otro', lastName: 'Paciente' })

          cy.login(account.email, account.password)
          cy.visit('/patients')

          // The NIF is what a patient reads off their card at the desk, and
          // what an insurer quotes back. It was the one identifier on the
          // record that the search could not match.
          cy.get('input[type="search"]').type('12345678Z')
          cy.contains('Dolores Documento').should('be.visible')
          cy.contains('Otro Paciente').should('not.exist')
        },
      )
    })
  })
})
