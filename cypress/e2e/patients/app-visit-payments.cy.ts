import type { StaffAccount } from '../../support/commands'

// A patient paying for a visit from the app, with nobody at the desk:
// ahead of a booked visit, or for the one just had (server/utils/appPayments.ts).
// Stripe itself is not reachable from CI, so the money arrives the way it
// does in production when the card needed a page -- as a signed
// payment_intent.succeeded carrying the visit -- and what is checked is what
// the clinic then sees: one receipt on the visit, one card payment, one
// factura, exactly as a card payment taken at the desk.

interface Clinic {
  account: StaffAccount
  webhookSecret: string
  typeId: string
  patientId: string
  token: string
}

function clinic(): Cypress.Chainable<Clinic> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const webhookSecret = `whsec_cypress_${stamp}`
  const email = `app-pay-${stamp}@example.test`
  const password = 'valencia2026'
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:enableAppPayments', { accountId: account.accountId, webhookSecret })
    return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', defaultPriceCents: 4500 }).then((type) => {
      // The practitioner's own price is the one charged, as online booking and the desk charge it.
      cy.task('db:setAppointmentTypeOverride', { accountId: account.accountId, appointmentTypeId: type.id, teamMemberId: account.teamMemberId, priceCents: 5000 })
      return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Prepago' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        return cy.task<string>('db:accessTokenFor', { email, password }).then((token) => ({ account, webhookSecret, typeId: type.id, patientId: patient.id, token }))
      })
    })
  })
}

function visit(c: Clinic, startsAt: Date) {
  return cy.task<{ id: string }>('db:createAppointment', {
    accountId: c.account.accountId,
    clinicId: c.account.clinicId,
    patientId: c.patientId,
    practitionerId: c.account.teamMemberId,
    appointmentTypeId: c.typeId,
    startsAt: startsAt.toISOString(),
  })
}

/** What Stripe sends once the patient's payment for a visit went through. */
function paid(c: Clinic, appointmentId: string, intentId: string, amountCents = 5000) {
  const body = JSON.stringify({
    id: `evt_${intentId}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: intentId, object: 'payment_intent', amount: amountCents, amount_received: amountCents, metadata: { app_visit_id: appointmentId, account_id: c.account.accountId, source: 'patient_pay' } } },
  })
  return cy.task<{ header: string }>('auto:signStripe', { body, secret: c.webhookSecret }).then(({ header }) =>
    cy
      .request({ method: 'POST', url: `/api/stripe/webhook/${c.account.accountId}`, body, headers: { 'content-type': 'application/json', 'stripe-signature': header } })
      .its('body')
      .should('deep.eq', { received: true }),
  )
}

function appView(c: Clinic) {
  return cy
    .request({ url: `/api/portal/payments?patientId=${c.patientId}`, headers: { Authorization: `Bearer ${c.token}` } })
    .its('body') as Cypress.Chainable<{ enabled: boolean; card: unknown; visits: { appointmentId: string; state: string; amountCents: number }[] }>
}

/** Tomorrow at noon, local: inside the calendar's day and far enough off to cancel. */
function tomorrowNoon() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(12, 0, 0, 0)
  return d
}

describe('Paying a visit from the patient app', () => {
  it('offers a booked visit at the practitioner’s own price, and nothing to someone holding a bono', () => {
    clinic().then((c) => {
      visit(c, tomorrowNoon()).then((appt) => {
        appView(c).then((view) => {
          expect(view.enabled).to.eq(true)
          expect(view.card).to.eq(null)
          expect(view.visits).to.deep.eq([{ appointmentId: appt.id, state: 'payable', amountCents: 5000 }])
        })
        // A visit a bono covers is drawn from the bono; paying it as well would pay twice.
        cy.task('db:createPackagePurchase', { accountId: c.account.accountId, patientId: c.patientId, sessionsTotal: 10, sessionsUsed: 2 })
        appView(c).its('visits').should('deep.eq', [])
      })
    })
  })

  it('offers nothing, and charges nothing, where the clinic has not turned it on', () => {
    clinic().then((c) => {
      cy.task('db:enableAppPayments', { accountId: c.account.accountId, webhookSecret: c.webhookSecret, enabled: false })
      visit(c, tomorrowNoon()).then((appt) => {
        appView(c).should('deep.eq', { enabled: false, card: null, visits: [] })
        cy.request({ method: 'POST', url: '/api/portal/appointments/pay', headers: { Authorization: `Bearer ${c.token}` }, body: { appointmentId: appt.id }, failOnStatusCode: false })
          .its('status')
          .should('eq', 400)
      })
    })
  })

  it('books a visit paid ahead once, on its own receipt, as a card payment at the desk is booked', () => {
    clinic().then((c) => {
      visit(c, tomorrowNoon()).then((appt) => {
        const intentId = `pi_cypress_ahead_${appt.id.slice(0, 8)}`
        // Delivered twice, as Stripe may: booked once.
        paid(c, appt.id, intentId)
        paid(c, appt.id, intentId)

        cy.task<{ invoice_number: string; status: string; total_cents: number; invoice_line_items: { description: string; price_cents: number }[]; payments: { amount_cents: number; method: string }[] }[]>(
          'db:invoicesForAppointment',
          { appointmentId: appt.id },
        ).then((invoices) => {
          expect(invoices).to.have.length(1)
          expect(invoices[0].status).to.eq('paid')
          expect(invoices[0].total_cents).to.eq(5000)
          expect(invoices[0].invoice_line_items.map((l) => [l.description, l.price_cents])).to.deep.eq([['Ajuste', 5000]])
          expect(invoices[0].payments).to.deep.eq([{ amount_cents: 5000, method: 'card' }])

          cy.task<{ purpose: string; stripe_payment_intent_id: string }[]>('db:cardPaymentsFor', { patientId: c.patientId }).then((payments) => {
            expect(payments.map((p) => [p.purpose, p.stripe_payment_intent_id])).to.deep.eq([['visit', intentId]])
          })
          cy.task<{ kind: string; description: string; amount_cents: number }[]>('db:facturasFor', { patientId: c.patientId }).then((facturas) => {
            expect(facturas.map((f) => [f.description, f.amount_cents])).to.deep.eq([['Ajuste', 5000]])
          })
          // Not finished: it has not happened yet.
          cy.task<{ status: string }>('db:appointmentById', { appointmentId: appt.id }).its('status').should('eq', 'booked')
          // The app now says it is paid, rather than offering it again.
          appView(c).its('visits').should('deep.eq', [{ appointmentId: appt.id, state: 'paid', amountCents: 5000 }])

          // And the clinic sees it in the patient's billing like any other card payment.
          cy.login(c.account.email, c.account.password)
          cy.visit(`/patients/${c.patientId}?tab=billing`)
          cy.contains(invoices[0].invoice_number).scrollIntoView().should('be.visible')
          cy.contains('50,00 €').should('exist')
        })
      })
    })
  })

  it('finishes the visit just had when the patient pays for it', () => {
    clinic().then((c) => {
      visit(c, new Date(Date.now() - 3 * 3_600_000)).then((appt) => {
        appView(c).its('visits').should('deep.eq', [{ appointmentId: appt.id, state: 'payable', amountCents: 5000 }])
        paid(c, appt.id, `pi_cypress_after_${appt.id.slice(0, 8)}`)
        cy.task<{ status: string }>('db:appointmentById', { appointmentId: appt.id }).its('status').should('eq', 'completed')
        cy.task<{ status: string }[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
          expect(invoices.map((i) => i.status)).to.deep.eq(['paid'])
        })
      })
    })
  })

  it('pays the receipt the desk raised meanwhile rather than raising a second', () => {
    clinic().then((c) => {
      visit(c, new Date(Date.now() - 3 * 3_600_000)).then((appt) => {
        cy.task('db:createInvoice', { accountId: c.account.accountId, patientId: c.patientId, appointmentId: appt.id, totalCents: 5000, status: 'unpaid' })
        paid(c, appt.id, `pi_cypress_race_${appt.id.slice(0, 8)}`)
        cy.task<{ status: string; payments: { amount_cents: number }[] }[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
          expect(invoices.map((i) => [i.status, i.payments.map((p) => p.amount_cents)])).to.deep.eq([['paid', [5000]]])
        })
      })
    })
  })

  it('lets the clinic keep a cancelled prepaid visit’s money as credit', () => {
    clinic().then((c) => {
      visit(c, tomorrowNoon()).then((appt) => {
        paid(c, appt.id, `pi_cypress_credit_${appt.id.slice(0, 8)}`)

        cy.login(c.account.email, c.account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[aria-label="Next"]').click()
        cy.contains('[data-cy=appt-block]', 'Lucía Prepago').click()
        cy.get('[data-cy=cancel-appointment]').click()
        cy.get('[data-cy=cancel-sheet]').within(() => {
          // cy.contains, not contain.text: the amount carries a non-breaking space before the €.
          cy.contains('[data-cy=cancel-prepaid]', 'They paid 50,00 € ahead by card').should('exist')
          // Back to the card is the default; keeping it is the other choice.
          cy.get('[data-cy=cancel-prepaid-refund] input').should('be.checked')
          cy.get('[data-cy=cancel-prepaid-credit]').click()
          cy.contains('[data-cy=cancel-summary]', '50,00 € stays on their account').should('exist')
          cy.get('[data-cy=confirm-cancel]').click()
        })
        cy.get('[data-cy=appt-sheet]').should('not.exist')

        cy.task<{ status: string }>('db:appointmentById', { appointmentId: appt.id }).its('status').should('eq', 'cancelled')
        // No visit to charge: the receipt is void, and the money is a top-up.
        cy.task<{ status: string }[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
          expect(invoices.map((i) => i.status)).to.deep.eq(['void'])
        })
        cy.task<{ id: string; purpose: string; invoice_id: string | null }[]>('db:cardPaymentsFor', { patientId: c.patientId }).then((payments) => {
          expect(payments.map((p) => [p.purpose, p.invoice_id])).to.deep.eq([['on_account', null]])
          cy.task<{ amount_cents: number; payment_id: string | null }[]>('db:creditsFor', { patientId: c.patientId }).then((credits) => {
            expect(credits.map((r) => [r.amount_cents, r.payment_id])).to.deep.eq([[5000, payments[0].id]])
          })
        })
        // Still the one factura: the money was received, and still is.
        cy.task('db:facturasFor', { patientId: c.patientId }).should('have.length', 1)
      })
    })
  })

  it('is turned on in Settings > Payments', () => {
    clinic().then((c) => {
      cy.task('db:enableAppPayments', { accountId: c.account.accountId, webhookSecret: c.webhookSecret, enabled: false })
      cy.login(c.account.email, c.account.password)
      cy.visit('/settings/payments')
      cy.get('[data-cy=payments-settings][data-ready=true]')
      cy.get('[data-cy=stripe-app-payments-toggle]').should('have.attr', 'aria-checked', 'false').click()
      cy.get('[data-cy=stripe-app-payments-toggle]').should('have.attr', 'aria-checked', 'true')
      cy.task('db:appPaymentsEnabled', { accountId: c.account.accountId }).should('eq', true)
    })
  })
})

// The pages Stripe sends the patient back to open in the phone's browser,
// with no QuiroFlow session. Found replaying the flows against Stripe's test
// mode: saving a card landed on the clinic's login page, and a payment whose
// 3-D Secure check FAILED was announced as "Pago recibido".
describe('Coming back from Stripe in the phone’s browser', () => {
  it('shows "card saved", not the clinic login, to someone signed out', () => {
    cy.visit('/card-saved?status=success&app=1')
    cy.location('pathname').should('eq', '/card-saved')
    cy.get('[data-cy=card-saved]').should('contain.text', 'Card saved').and('contain.text', 'Go back to the app')
  })

  it('never says a 3-D Secure payment went through without asking Stripe', () => {
    // A return it cannot confirm: an account with no such payment.
    cy.visit('/payment-done?status=check&account=00000000-0000-0000-0000-000000000000&payment_intent=pi_cypress&payment_intent_client_secret=pi_cypress_secret_x')
    cy.get('[data-cy=payment-done]').should('have.attr', 'data-status', 'unknown').and('contain.text', 'Payment pending confirmation').and('not.contain.text', 'Payment received')
  })

  it('tells the status of a payment only to whoever holds its client secret', () => {
    const status = (qs: string) => cy.request({ url: `/api/pay/intent-status?${qs}`, failOnStatusCode: false }).its('status')
    status('account=00000000-0000-0000-0000-000000000000').should('eq', 400)
    status('account=00000000-0000-0000-0000-000000000000&payment_intent=pi_cypress&payment_intent_client_secret=pi_cypress_secret_x').should('eq', 404)
  })
})
