// The same rule the public booking form got, on the three staff-side fields
// that write patient_contact_numbers.
//
// A number typed at the desk is what every recall, reminder and WhatsApp
// thread is addressed to afterwards, and none of these fields checked what
// they were given. The number stays OPTIONAL everywhere here -- a walk-in who
// will not give one still gets a record and an appointment. The rule is only
// that something typed into the field has to be a number.
// scrollBehavior 'center' rather than Cypress's default 'top': these fields
// live in a dialog with a sticky header, and scrolling a row to the top of it
// parks the row underneath that header, which Cypress rightly calls covered.
// Nothing here is testing layout, so centring is the honest fix -- force:true
// would skip the visibility check altogether and hide a real regression.
describe('A phone number typed by staff', { scrollBehavior: 'center' }, () => {
  function openAllDetails(account: any, patient: any) {
    cy.login(account.email, account.password)
    cy.visit(`/patients/${patient.id}`)
    cy.contains('button', 'Edit all details', { timeout: 15000 }).click()
  }

  it('is refused when adding one that is not a number', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Anade',
        lastName: 'Numero',
      }).then((patient: any) => {
        openAllDetails(account, patient)

        cy.contains('Phone numbers').should('be.visible')
        cy.get('[data-cy=new-contact-number]').type('6')
        cy.get('[data-cy=add-contact-number]').click()

        cy.contains('A Spanish number has 9 digits.').should('be.visible')
        cy.task('db:patientWithContacts', { id: patient.id }).should((r: any) => {
          expect(r.numbers, 'nothing was stored').to.have.length(0)
        })

        // And the message goes as soon as the field is corrected, rather than
        // sitting there about a value that is no longer in it.
        cy.get('[data-cy=new-contact-number]').type('00123456')
        cy.contains('A Spanish number has 9 digits.').should('not.exist')
        cy.get('[data-cy=add-contact-number]').click()
        cy.task('db:patientWithContacts', { id: patient.id }).should((r: any) => {
          expect(r.numbers.map((n: any) => n.number)).to.deep.equal(['600123456'])
        })
      })
    })
  })

  it('says a bad edit was not saved, instead of showing it as though it were', () => {
    // The case that used to lie. The old code assigned the typed value to the
    // row and THEN returned without writing when it was blank, so the field
    // showed one thing and the database held another with nothing on screen
    // to say so.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Edita',
        lastName: 'Numero',
        phone: '600111222',
      }).then((patient: any) => {
        openAllDetails(account, patient)

        cy.get('[data-cy=contact-number]').clear().type('6').blur()

        cy.contains('Not saved').should('be.visible')
        cy.task('db:patientWithContacts', { id: patient.id }).should((r: any) => {
          expect(r.numbers.map((n: any) => n.number), 'the stored number is untouched').to.deep.equal(['600111222'])
        })

        // Correcting it saves, and the message goes with it.
        cy.get('[data-cy=contact-number]').clear().type('600999888').blur()
        cy.contains('Not saved').should('not.exist')
        cy.task('db:patientWithContacts', { id: patient.id }).should((r: any) => {
          expect(r.numbers.map((n: any) => n.number)).to.deep.equal(['600999888'])
        })
      })
    })
  })

  it('leaves a number already on file editable in every other way', () => {
    // Production holds three numbers this rule would refuse today, one of
    // them a single digit. Checking on every blur, or on a WhatsApp toggle,
    // would make exactly those rows uneditable -- when they are the rows most
    // in need of editing.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Heredada',
        lastName: 'Numero',
        phone: '6',
      }).then((patient: any) => {
        openAllDetails(account, patient)

        // Nothing is complained about until the number itself is touched.
        cy.contains('Not saved').should('not.exist')

        cy.get('[data-cy=contact-whatsapp]').check()
        cy.contains('Not saved').should('not.exist')
        cy.task('db:patientWithContacts', { id: patient.id }).should((r: any) => {
          expect(r.numbers[0].is_whatsapp, 'the toggle still works on a legacy number').to.equal(true)
          expect(r.numbers[0].number, 'and the number is left as it was').to.equal('6')
        })
      })
    })
  })

  it('is refused on the Add patient form, before a patient row exists', () => {
    // The number is inserted in a second statement after the patient, so
    // letting a bad one through here would create the patient and then file
    // the junk against them.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.clickUntil('button:contains("New patient")', '#first-name')

      cy.get('#first-name').type('Telefono')
      cy.get('#last-name').type('Malo')
      cy.get('input[type="tel"]').type('6')
      cy.contains('button', 'Add Patient').click()

      cy.contains('A Spanish number has 9 digits.').should('be.visible')
      // Still on the list: a successful Add navigates to the new record, so
      // staying put is how "no patient was created" is visible from here.
      cy.location('pathname').should('eq', '/patients')

      cy.get('input[type="tel"]').clear().type('600123456')
      cy.contains('button', 'Add Patient').click()
      cy.location('pathname', { timeout: 15000 }).should('match', /^\/patients\/[0-9a-f-]+$/)
    })
  })
})
