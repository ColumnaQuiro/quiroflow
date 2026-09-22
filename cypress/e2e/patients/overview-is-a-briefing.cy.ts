// Overview leads with what needs doing, not with an address.
//
// It used to open with four counters and then the fourteen-field
// administrative record. Those answer "who is this on paper" -- a question
// asked while correcting a typo or chasing an insurer, not one anyone has
// four minutes before a patient walks in. The counters moved to
// Appointments; the record moved behind one button.
describe('The patient Overview', () => {
  it('leads with what needs attention, and the action that clears it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Aurora',
        lastName: 'Pendiente',
      }).then((patient: any) => {
        cy.task('db:createInvoice', {
          accountId: account.accountId,
          patientId: patient.id,
          invoiceNumber: 'INV-OV-1',
          totalCents: 8800,
          status: 'unpaid',
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // The sentence names the thing and its date, and carries one action.
        cy.contains('Needs attention').should('be.visible')
        cy.contains('88,00').should('be.visible')
        cy.contains('button', 'Take payment').click()
        cy.url().should('include', 'tab=money')
      })
    })
  })

  it('renders no Needs attention card at all when nothing needs it', () => {
    // Absent, not an empty "all clear" card: a permanently-present box
    // trains people to skip the top of the page, which is exactly where the
    // things that DO need attention will appear.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Tranquila',
        lastName: 'Sinnada',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('Next appointment').should('be.visible')
        cy.contains('Needs attention').should('not.exist')
      })
    })
  })

  it('footnotes the last visit with how it was paid', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Ultima',
        lastName: 'Visita',
      }).then((patient: any) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date(Date.now() - 9 * 86400000).toISOString(),
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:createInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            appointmentId: appt.id,
            invoiceNumber: 'INV-OV-2',
            totalCents: 4400,
            status: 'paid',
          }).then((invoice: any) => {
            cy.task('db:createPayment', {
              accountId: account.accountId,
              patientId: patient.id,
              invoiceId: invoice.id,
              amountCents: 4400,
              method: 'card',
            })
          })
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // §4 sends "last visit" here as a footnote on the next-appointment
        // card, rather than back into a KPI tile.
        cy.contains('Last visit').should('be.visible').and('contain.text', 'paid by card')
      })
    })
  })

  it('shows no KPI strip, because those figures now live where they belong', () => {
    // §4: one home per fact. Balance is the banner pill and Money; the visit
    // counters are Appointments. Overview may only carry a balance inside a
    // Needs attention row that has an action attached, which the first test
    // covers.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Sinkpis',
        lastName: 'Resumen',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('Next appointment').should('be.visible')

        for (const gone of ['Visits, 12 mo', 'Attendance', 'Show rate', 'Lifetime value']) {
          cy.contains(gone).should('not.exist')
        }
      })
    })
  })

  it('keeps the full record one button away, and still saves it', () => {
    // The riskiest part of this change: a fourteen-field form was lifted out
    // of the page into a dialog. If it saves, it survived the move.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Ficha',
        lastName: 'Completa',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('button', 'Edit all details').click()
        cy.get('[role="dialog"]').should('be.visible')

        // A field that is NOT among the six on the summary card, so this
        // proves the dialog carries the whole record.
        cy.get('[role="dialog"]').contains('label', 'Occupation').parent().find('input').clear().type('Carpintera')
        cy.get('[role="dialog"]').contains('button', 'Save').click()

        cy.contains('Patient saved').should('be.visible')
        cy.get('[role="dialog"]').should('not.exist')

        // And it really reached the database, not just the screen.
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Edit all details').click()
        cy.get('[role="dialog"]').contains('label', 'Occupation').parent().find('input').should('have.value', 'Carpintera')
      })
    })
  })
})
