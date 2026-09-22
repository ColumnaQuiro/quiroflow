// The appointment row now answers "how was this paid for".
//
// It is the question the front desk asks most often about a past visit, and
// the answer was four tables away: a bono draw, an invoice, the payments
// settling it, and any factura those produced. A row that said only
// "Completed" sent whoever asked into the Money tab to work it out.
//
// The rules themselves are unit-tested in visit-payment-rules.cy.ts. This
// spec is about the wiring: that the four queries find the right rows and
// the right phrase reaches the right visit.
describe('A visit says how it was paid', () => {
  it('shows a bono draw, a settled charge and an unpaid one, each on its own row', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Visitacion',
        lastName: 'Pagos',
      }).then((patient: any) => {
        const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString()

        // 1. A visit drawn from a bono. No invoice, no payment, no document
        //    -- and paid for.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 10',
          sessionsTotal: 10,
          sessionsUsed: 0,
          priceCents: 40000,
          owedCents: 0,
        }).then((purchase: any) => {
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            startsAt: day(-20),
            status: 'completed',
          }).then((appt: any) => {
            cy.task('db:usePackageSession', {
              accountId: account.accountId,
              patientId: patient.id,
              packagePurchaseId: purchase.id,
              appointmentId: appt.id,
              amountCents: 4000,
              externalReference: 'BONO-55',
            })
          })
        })

        // 2. A visit charged and settled by card, with a factura issued.
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: day(-10),
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:createInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            appointmentId: appt.id,
            invoiceNumber: 'INV-PAID-1',
            totalCents: 4400,
            status: 'paid',
          }).then((invoice: any) => {
            cy.task('db:createPayment', {
              accountId: account.accountId,
              patientId: patient.id,
              invoiceId: invoice.id,
              amountCents: 4400,
              method: 'card',
            }).then((payment: any) => {
              cy.task('db:createFactura', {
                accountId: account.accountId,
                patientId: patient.id,
                paymentId: payment.id,
                number: 'F2026-0044',
                description: 'Sesion',
                amountCents: 4400,
              })
            })
          })
        })

        // 3. A visit charged and not yet paid.
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: day(-5),
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:createInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            appointmentId: appt.id,
            invoiceNumber: 'INV-OWED-1',
            totalCents: 6600,
            status: 'unpaid',
          })
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=appointments`)

        // The bono row names the pack, what is left of it, and the clinic's
        // own reference -- which is what staff quote.
        cy.contains('li', 'Bono 10').should('contain.text', '9').and('contain.text', 'left')
        cy.contains('li', 'Bono 10').should('contain.text', 'BONO-55')

        // The settled row names the factura, not the internal invoice.
        cy.contains('li', 'F2026-0044').should('contain.text', 'Card')

        // The unpaid row says so, with the amount, in es-ES.
        cy.contains('li', 'INV-OWED-1').should('contain.text', 'Unpaid').and('contain.text', '66,00')
      })
    })
  })

  it('separates upcoming from past, and counts only the last twelve months as visits', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Contador',
        lastName: 'Visitas',
      }).then((patient: any) => {
        const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString()
        const appt = (startsAt: string, status: string) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, startsAt, status })

        appt(day(-30), 'completed')
        appt(day(-60), 'completed')
        // Older than a year: real history, but not a "visits, 12 mo" figure.
        appt(day(-400), 'completed')
        appt(day(7), 'booked')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=appointments`)

        cy.contains('dt', 'Visits, 12 mo').parent().should('contain.text', '2')

        // The booked one is upcoming; the three completed ones are past.
        cy.contains('h2', 'Upcoming').should('contain.text', '1')
        cy.contains('h2', 'Past').should('contain.text', '3')
      })
    })
  })

  it('fits both widths without pushing the page sideways', () => {
    // The row carries a date block, a time, a where-line, a payment phrase,
    // status pills and actions. That is a lot to keep inside 1440, and the
    // patient list had already taught this work that a column falling off
    // the right edge is invisible until someone measures it.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Medida', lastName: 'Ancho' }).then((patient: any) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date(Date.now() - 5 * 86400000).toISOString(),
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:createInvoice', {
            accountId: account.accountId,
            patientId: patient.id,
            appointmentId: appt.id,
            invoiceNumber: 'INV-WIDE-1',
            totalCents: 4400,
            status: 'unpaid',
          })
        })

        cy.login(account.email, account.password)

        for (const [width, height] of [[1440, 900], [390, 844]] as [number, number][]) {
          cy.viewport(width, height)
          cy.visit(`/patients/${patient.id}?tab=appointments`)
          cy.contains('dt', 'Visits, 12 mo').should('be.visible')
          cy.contains('dt', 'Cancelled').should('be.visible')
          cy.document().then((doc) => {
            expect(doc.documentElement.scrollWidth, `no sideways scroll at ${width}`).to.be.at.most(
              doc.documentElement.clientWidth,
            )
          })
        }
      })
    })
  })
})
