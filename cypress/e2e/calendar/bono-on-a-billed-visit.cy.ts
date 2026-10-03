import { assertDayGridShows, yesterday } from '../../support/calendar'

// Using a bono on a visit that already had a receipt raised a SECOND receipt
// for the same appointment: the existing one was repriced, and the bono
// session's own charge was inserted beside it. The appointment's billing tab
// reads "the" receipt with .maybeSingle(), which errors on two rows -- so the
// receipt still open for the extras vanished from the tab, and reception had
// no way to take the money owed on it.
//
// Now the existing receipt is reused whenever it would be left holding no
// charge of its own; and when it keeps extras it stays on the tab, with the
// bono's session charge beside it and said so.
const bookedDay = yesterday()

function at(day: Date, hour: number): string {
  const d = new Date(day)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function openBilling(name: string) {
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.get('[aria-label="Previous"]').click()
  assertDayGridShows(bookedDay)
  cy.contains(name).should('be.visible').click({ force: true })
  cy.get('[data-cy=appt-sheet]').should('be.visible')
  cy.get('[data-cy=appt-sheet]').within(() => {
    cy.get('[data-cy=appt-tab-billing]').click()
  })
}

function seedVisitWithReceipt(account: any, firstName: string) {
  return cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Recibida' }).then((patient) => {
    return cy
      .task<any>('db:createPackagePurchase', {
        accountId: account.accountId,
        patientId: patient.id,
        packageName: 'Bono 12',
        sessionsTotal: 12,
        sessionsUsed: 0,
        priceCents: 52800,
      })
      .then((purchase) => {
        // Prepaid in full, so the session's own charge is covered.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 52800, method: 'card', packagePurchaseId: purchase.id, purpose: 'bono' })
        return cy
          .task<any>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: at(bookedDay, 10),
            status: 'completed',
          })
          .then((appt) =>
            cy
              .task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, appointmentId: appt.id, invoiceNumber: `INV-${firstName.toUpperCase()}`, totalCents: 5000, status: 'unpaid' })
              .then((invoice) => {
                // The visit's own line, at the walk-in price.
                cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Consulta', priceCents: 5000 })
                return cy.wrap({ patient, purchase, appt, invoice })
              }),
          )
      })
  })
}

describe('A bono on a visit that already has a receipt', () => {
  it('keeps the receipt open for the extras on the tab, beside the session charge', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task<any>('db:createServiceProduct', { accountId: account.accountId, name: 'Crema', priceCents: 1000 }).then((service) => {
        seedVisitWithReceipt(account, 'Extra').then(({ appt, invoice }: any) => {
          // A product sold at the visit: real money owed on top of the bono.
          cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Crema', priceCents: 1000, serviceId: service.id })
          cy.task('db:setInvoiceTotal', { invoiceId: invoice.id, totalCents: 6000 })

          cy.login(account.email, account.password)
          openBilling('Extra Recibida')
          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.contains('button', 'Bono 12', { timeout: 15000 }).click()
            cy.contains('Covered by', { timeout: 15000 }).should('be.visible')
            // The receipt still owed for the extras is the one on the tab.
            cy.contains('INV-EXTRA').should('be.visible')
            cy.contains('Total: 10,00 €').should('be.visible')
            cy.contains('Balance due: 10,00 €').should('be.visible')
          })

          cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((rows) => {
            const extras = rows.find((r) => r.id === invoice.id)
            expect(extras.status, 'the extras are still owed').to.eq('unpaid')
            expect(extras.total_cents).to.eq(1000)
            expect(extras.invoice_line_items.map((l: any) => l.description)).to.deep.eq(['Crema'])
          })
        })
      })
    })
  })

  it('reuses the receipt rather than raising a second one when nothing else is on it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      seedVisitWithReceipt(account, 'Parcial').then(({ appt, invoice }: any) => {
        // EUR 20 taken at the walk-in price before anyone remembered the bono.
        cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 2000, method: 'cash' })

        cy.login(account.email, account.password)
        openBilling('Parcial Recibida')
        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.contains('button', 'Bono 12', { timeout: 15000 }).click()
          cy.contains('Covered by', { timeout: 15000 }).should('be.visible')
          cy.contains('INV-PARCIAL').should('be.visible')
        })

        cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((rows) => {
          const standing = rows.filter((r) => r.status !== 'void')
          expect(standing, 'one receipt for one visit').to.have.length(1)
          expect(standing[0].id, 'the one it already had').to.eq(invoice.id)
          expect(standing[0].total_cents, 'at the bono rate').to.eq(4400)
          expect(standing[0].invoice_line_items).to.have.length(1)
          expect(standing[0].invoice_line_items[0].package_purchase_id, 'names the bono').to.not.eq(null)
          expect(standing[0].payments, 'the cash taken stays on it').to.have.length(1)
        })
      })
    })
  })
})
