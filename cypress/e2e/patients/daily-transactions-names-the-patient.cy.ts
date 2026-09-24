// The day sheet is read at the end of the day against the drawer and the card
// terminal, so every row has to be attributable to someone. Two columns were
// not.
//
// The Patient column reached the patient through the payment's INVOICE, and
// a payment that settles no particular charge has none: a bono purchase, an
// on-account top-up, and all 3,262 payments imported from PracticeHub. Those
// rows read "Unknown" and linked to /patients/undefined -- so every day
// before mid-September 2026 was a full page of "Unknown", and reception had
// no way to tell whose €240 was in the drawer.
//
// The Practitioner column had the opposite shape of bug: the appointments it
// reads were only fetched when a practitioner or clinic FILTER was set, so
// the default view of the page said "Unassigned" on every row regardless of
// who had actually seen the patient.
describe('The day sheet attributes every row', () => {
  it('names the patient on a payment that settles no invoice, and links to them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Amparo',
        lastName: 'Bonos',
      }).then((patient: any) => {
        // A bono raises no invoice -- its price sits on the purchase and
        // payments come off it -- which is exactly the shape that used to
        // lose its patient.
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 24000,
          method: 'card',
          purpose: 'bono',
        })

        cy.login(account.email, account.password)
        cy.visit('/reports/daily-transactions')
        cy.contains('Net collected').should('be.visible')

        cy.contains('td', 'Amparo Bonos')
          .should('be.visible')
          .find('a')
          // The href is half the point: the name used to render "Unknown"
          // over a link to /patients/undefined, which 404s.
          .should('have.attr', 'href', `/patients/${patient.id}`)

        cy.contains('td', 'Unknown').should('not.exist')
        // The Receipt column is right to stay empty here -- there is no
        // invoice to name. That was never the broken part.
        cy.contains('td', '—').should('be.visible')
      })
    })
  })

  it('names the practitioner without waiting for a filter to be picked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Nuria',
        lastName: 'Visita',
      }).then((patient: any) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date().toISOString(),
          practitionerId: account.teamMemberId,
        }).then((appointment: any) => {
          cy.task('db:createInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            invoiceNumber: 'F-9001',
            totalCents: 5500,
            appointmentId: appointment.id,
          }).then((invoice: any) => {
            cy.task('db:createPayment', {
              accountId: account.accountId,
              patientId: patient.id,
              invoiceId: invoice.id,
              amountCents: 5500,
              method: 'cash',
              purpose: 'visit',
            })

            cy.login(account.email, account.password)
            cy.visit('/reports/daily-transactions')
            cy.contains('Net collected').should('be.visible')

            // No filter touched. This is the page as it opens.
            cy.contains('tr', 'Nuria Visita').within(() => {
              cy.contains('td', 'Test Owner').should('be.visible')
              cy.contains('td', 'Unassigned').should('not.exist')
            })
          })
        })
      })
    })
  })

  // Two card payments of the same amount, minutes apart, on the same morning.
  // Ana Paula Mañanes has exactly this on 15 Sep 2026 and it reads as a double
  // charge: one settled that day's visit, the other went on account and paid
  // the visit two days later. payments.purpose said so all along and the day
  // sheet never showed it.
  it('says what each payment was for, so two of the same amount are telling apart', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Dos',
        lastName: 'Cobros',
      }).then((patient: any) => {
        cy.task('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          invoiceNumber: 'F-9100',
          totalCents: 5500,
        }).then((invoice: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            invoiceId: invoice.id,
            amountCents: 5500,
            method: 'card',
            purpose: 'visit',
          })
          // The second €55: same amount, same method, same morning, and not
          // the same thing at all.
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            amountCents: 5500,
            method: 'card',
            purpose: 'on_account',
          })

          cy.login(account.email, account.password)
          cy.visit('/reports/daily-transactions')
          cy.contains('Net collected').should('be.visible')

          cy.contains('tr', 'F-9100').should('contain.text', 'Visit')
          // The one with no receipt is the one the question was about. It is
          // not a mystery row any more.
          cy.contains('tr', 'On account').should('exist').and('not.contain.text', 'F-9100')
        })
      })
    })
  })

  it('leaves an imported payment blank rather than inventing what it was for', () => {
    // Every payment that came from PracticeHub has no purpose -- 3,288 of
    // them. A dash says "not recorded"; anything else would be a claim
    // nobody made.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Sin',
        lastName: 'Concepto',
      }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 7000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit('/reports/daily-transactions')
        cy.contains('Net collected').should('be.visible')

        cy.contains('tr', 'Sin Concepto').within(() => {
          for (const label of ['Visit', 'Bono', 'Membership', 'On account']) {
            cy.contains('td', label).should('not.exist')
          }
        })
      })
    })
  })
})
