// The search in the top bar (AppCommandPalette). It listed patients by name
// alone, so two people with the same name were two identical rows. Each now
// carries what the front desk asks to tell them apart: date of birth, a phone,
// and whether the record is inactive.
//
// It also searched the name alone, while the Patients page finds people by
// name, phone, email or DNI: a caller's number typed here found nobody. It is
// the same search now (patients_matching), and the arrows and Enter work it.

function openPalette() {
  // Rendered on the server: a click before hydration does nothing.
  cy.clickUntil('button[title^="Search or jump to"]', '[role=dialog] input')
}

describe('Patients in the top-bar search', () => {
  it('tells two patients with the same name apart', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'María', lastName: 'García', dateOfBirth: '1985-03-12', phone: '612345678' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'María', lastName: 'García', dateOfBirth: '1962-11-30' }).then((older) => {
        cy.task('db:updateRows', { table: 'patients', match: { id: older.id }, values: { status: 'inactive' } })
      })

      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      openPalette()
      cy.get('[role=dialog] input').type('maria garcia')
      cy.get('[data-cy=palette-patient]').should('have.length', 2)
      cy.get('[data-cy=palette-patient-detail]').then(($d) => {
        const details = [...$d].map((el) => el.textContent?.trim()).sort()
        expect(details).to.deep.equal(['12 Mar 1985 · +34 612345678', '30 Nov 1962 · Inactive'])
      })
    })
  })

  it('finds a patient by phone, email or DNI, and shows what it was found by', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Teléfono', phone: '698765432', email: 'lucia.contacto@example.test', nationalId: '12345678Z' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Otra', phone: '611222333' })

      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      openPalette()

      cy.get('[role=dialog] input').type('698765')
      cy.get('[data-cy=palette-patient]').should('have.length', 1).and('contain.text', 'Lucía Teléfono')
      cy.get('[data-cy=palette-patient-detail]').should('contain.text', '+34 698765432')

      // Found by something the row would not otherwise show: it says what.
      cy.get('[role=dialog] input').clear().type('lucia.contacto')
      cy.get('[data-cy=palette-patient]').should('have.length', 1).and('contain.text', 'Lucía Teléfono')
      cy.get('[data-cy=palette-patient-detail]').should('contain.text', 'lucia.contacto@example.test')

      cy.get('[role=dialog] input').clear().type('12345678z')
      cy.get('[data-cy=palette-patient]').should('have.length', 1)
      cy.get('[data-cy=palette-patient-detail]').should('contain.text', '12345678Z')
    })
  })

  it('moves through the results with the arrows and opens one with Enter', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Flecha' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Berta', lastName: 'Flecha' }).then((berta) => {
        cy.login(account.email, account.password)
        cy.visit('/dashboard')
        openPalette()

        cy.get('[role=dialog] input').type('flecha')
        cy.get('[data-cy=palette-patient]').should('have.length', 2)
        // The first result is the one Enter would open, and the field says so.
        cy.get('[data-cy=palette-patient]').eq(0).should('contain.text', 'Ana Flecha').and('have.attr', 'aria-selected', 'true')
        cy.get('[data-cy=palette-patient]').eq(0).invoke('attr', 'id').then((id) => {
          cy.get('[role=dialog] input').should('have.attr', 'aria-activedescendant', id)
        })

        // Up from the first row is the last one, and down from there the first.
        cy.get('[role=dialog] input').type('{uparrow}')
        cy.get('[role=dialog] [role=option]').last().should('have.attr', 'aria-selected', 'true')
        cy.get('[role=dialog] input').type('{downarrow}')
        cy.get('[data-cy=palette-patient]').eq(0).should('have.attr', 'aria-selected', 'true')

        cy.get('[role=dialog] input').type('{downarrow}')
        cy.get('[data-cy=palette-patient]').eq(1).should('contain.text', 'Berta Flecha').and('have.attr', 'aria-selected', 'true')
        cy.get('[role=dialog] [role=option][aria-selected=true]').should('have.length', 1)
        cy.get('[role=dialog] input').type('{enter}')
        cy.location('pathname').should('eq', `/patients/${berta.id}`)
        cy.get('[role=dialog]').should('not.exist')
      })
    })
  })
})
