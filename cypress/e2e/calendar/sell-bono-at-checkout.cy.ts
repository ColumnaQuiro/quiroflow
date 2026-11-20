import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// Selling a bono from the visit's checkout, with this visit as its first
// session. A patient who decides to buy one at the end of a visit used to send
// reception out of the appointment to the patient's record to sell it, and
// back to draw the session.
//
// Yesterday, for the reason bono-covered-visit.cy.ts gives: a visit that has
// not happened yet is not offered for charging.
const bookedDay = yesterday()

function bookAndOpen(patientName: string, typeName: string) {
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  openNewAppointmentPanel()
  cy.get('[data-cy=create-sheet]').within(() => {
    cy.get('[data-cy=create-patient-search]').type(patientName.split(' ')[0])
    cy.contains('[data-cy=create-patient-result]', patientName).click()
    cy.contains('[data-cy=create-type]', typeName).click()
    cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
    cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
    cy.get('[data-cy=create-submit]').click()
  })
  cy.get('[data-cy=create-sheet]').should('not.exist')
  cy.get('[aria-label="Previous"]').click()
  assertDayGridShows(bookedDay)
  cy.contains(patientName).should('be.visible').click({ force: true })
  cy.get('[data-cy=appt-sheet]').should('be.visible')
}

function chooseBono12() {
  // By value: the option's label carries formatEur's non-breaking space.
  cy.get('[data-cy=checkout-sell-select] option').contains('Bono 12').then(($o) => {
    cy.get('[data-cy=checkout-sell-select]').select(String($o.val()))
  })
}

describe('Selling a bono at the visit checkout', () => {
  it('sells it, takes the payment, and draws this visit as its first session', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 })
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sole', lastName: 'Sellhere' }).then((patient: any) => {
        cy.login(account.email, account.password)
        bookAndOpen('Sole Sellhere', 'Consultation')

        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=visit-checkout]').within(() => {
            // No bono held, so money opens selected and selling is an option.
            cy.get('[data-cy=checkout-money]').should('have.attr', 'aria-checked', 'true')
            cy.get('[data-cy=checkout-sell-bono]').should('contain.text', 'Sell a bono').click().should('have.attr', 'aria-checked', 'true')
            cy.get('[data-cy=checkout-process]').should('be.disabled')
            chooseBono12()
            // Opens at the bono's price, paid in full.
            cy.get('[data-cy=checkout-sell-amount]').should('have.value', '528.00')
            cy.get('[data-cy=checkout-sell-owed-note]').should('not.exist')
            cy.get('[data-cy=checkout-process]').should('contain.text', 'sell Bono 12, use 1 session').click()
          })
          // Covered by the new bono: the offer goes.
          cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')
          cy.get('[data-cy=undo-visit]').should('contain.text', 'Remove bono')
        })

        cy.task('db:packagePurchasesFor', { patientId: patient.id }).then((purchases: any) => {
          expect(purchases, 'one bono sold').to.have.length(1)
          expect(purchases[0].package_name).to.eq('Bono 12')
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchases[0].id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'this visit is its first session').to.eq(1)
            expect(eff.sessions, 'recorded once').to.have.length(1)
            // Charged at the bono's rate and settled by the money just paid:
            // no invoice for the sale itself, one paid charge for the visit.
            expect(eff.invoices, 'the visit charge only').to.have.length(1)
            expect(eff.invoices[0].total_cents).to.eq(4400)
            expect(eff.invoices[0].status).to.eq('paid')
            expect(eff.appointments[0].status).to.eq('completed')
          })
          cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
            expect(payments, 'the bono payment').to.have.length(1)
            expect(payments[0].amount_cents).to.eq(52800)
            expect(payments[0].purpose).to.eq('bono')
            expect(payments[0].package_purchase_id).to.eq(purchases[0].id)
            expect(payments[0].invoice_id).to.eq(null)
          })
          cy.task('db:facturasFor', { patientId: patient.id }).then((facturas: any) => {
            expect(facturas, 'a factura for the money paid').to.have.length(1)
            expect(facturas[0].amount_cents).to.eq(52800)
          })
        })
      })
    })
  })

  it('sells it part-paid, leaving the rest owed on the bono', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 })
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pia', lastName: 'Partpaid' }).then((patient: any) => {
        cy.login(account.email, account.password)
        bookAndOpen('Pia Partpaid', 'Consultation')

        cy.get('[data-cy=visit-checkout]').within(() => {
          cy.get('[data-cy=checkout-sell-bono]').click()
          chooseBono12()
          cy.get('[data-cy=checkout-sell-amount]').clear().type('100')
          cy.get('[data-cy=checkout-sell-owed-note]').should('be.visible')
          cy.get('[data-cy=checkout-process]').click()
        })
        cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')

        cy.task('db:packagePurchasesFor', { patientId: patient.id }).then((purchases: any) => {
          expect(purchases).to.have.length(1)
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchases[0].id }).then((eff: any) => {
            expect(eff.purchase.sessions_used).to.eq(1)
            expect(eff.invoices).to.have.length(1)
            expect(eff.invoices[0].total_cents).to.eq(4400)
            // 100 paid covers a 44 session.
            expect(eff.invoices[0].status).to.eq('paid')
          })
          cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
            expect(payments).to.have.length(1)
            expect(payments[0].amount_cents).to.eq(10000)
            expect(payments[0].package_purchase_id).to.eq(purchases[0].id)
          })
        })
      })
    })
  })

  // The visit that uses up a bono is paid by that bono, so the checkout -- and
  // its "Sell a bono" -- is gone by the time the patient asks for the next one.
  // Reception had to leave the appointment to sell it (19 Nov).
  it('sells the next bono once this visit has used up the last session, drawing nothing from it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 })
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lena', lastName: 'Lastsession' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 10',
          sessionsTotal: 10,
          sessionsUsed: 9,
          priceCents: 46000,
        }).then((oldBono: any) => {
          cy.login(account.email, account.password)
          bookAndOpen('Lena Lastsession', 'Consultation')

          cy.get('[data-cy=appt-sheet]').within(() => {
            // Not offered while the visit still has a bono session to draw.
            cy.get('[data-cy=next-bono]').should('not.exist')
            cy.get('[data-cy=visit-checkout]').within(() => {
              cy.get('[data-cy=checkout-bono]').should('contain.text', '1 left, 0 after this visit')
              cy.get('[data-cy=checkout-process]').click()
            })
            cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')

            cy.get('[data-cy=next-bono]', { timeout: 15000 }).within(() => {
              cy.get('[data-cy=next-bono-open]').should('contain.text', 'Sell a new bono').click()
              cy.get('[data-cy=next-bono-sell]').should('be.disabled')
              chooseBono12()
              cy.get('[data-cy=checkout-sell-amount]').should('have.value', '528.00')
              cy.get('[data-cy=next-bono-sell]').should('contain.text', 'Sell Bono 12').click()
              cy.get('[data-cy=next-bono-sold]', { timeout: 15000 }).should('contain.text', 'Bono 12 sold')
            })
          })

          cy.task('db:packagePurchasesFor', { patientId: patient.id }).then((purchases: any) => {
            expect(purchases, 'the old bono and the new one').to.have.length(2)
            const fresh = purchases.find((p: any) => p.package_name === 'Bono 12')
            expect(fresh, 'Bono 12 sold').to.exist
            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: fresh.id }).then((eff: any) => {
              expect(eff.purchase.sessions_used, 'nothing drawn from the new bono').to.eq(0)
            })
            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: oldBono.id }).then((eff: any) => {
              expect(eff.purchase.sessions_used, "this visit was the old bono's last").to.eq(10)
              expect(eff.sessions, 'one session for this visit').to.have.length(1)
            })
            cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
              expect(payments, 'the new bono, paid in full').to.have.length(1)
              expect(payments[0].amount_cents).to.eq(52800)
              expect(payments[0].package_purchase_id).to.eq(fresh.id)
            })
          })
        })
      })
    })
  })
})
