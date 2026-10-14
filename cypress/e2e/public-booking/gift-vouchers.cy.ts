// Gift vouchers ("bono regalo"): the clinic switches them on and picks what
// to sell (Settings > Bonos regalo), someone buys one on /regalo/<slug> and
// pays on Stripe (stubbed: Stripe is not reachable here, so the payment is
// its signed payment_intent.succeeded webhook), and the person who receives
// it redeems it at the desk or when they book. Redeeming records what the
// desk records for the same thing -- a card payment, credit or the bono, and
// its factura -- and only once.

interface Account { accountId: string; accountSlug: string; clinicId: string; email: string; password: string; teamMemberId: string }

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const code = () => `REGALO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
const inAYear = () => new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()

function selectBookableDayWithSlots(attempt = 0) {
  cy.get('.grid.grid-cols-7 button:not([disabled])').eq(attempt).click()
  cy.contains('Cargando horarios').should('not.exist')
  cy.get('body').then(($body) => {
    if ($body.text().includes('No hay horas disponibles')) {
      if (attempt > 15) throw new Error('No bookable day within the visible range had available slots')
      selectBookableDayWithSlots(attempt + 1)
    }
  })
}

describe('Gift vouchers', () => {
  let account: Account
  beforeEach(() => {
    cy.seedStaffAccount().then((a) => {
      account = a as unknown as Account
      cy.task('db:updateRows', { table: 'accounts', values: { stripe_publishable_key: 'pk_test_example' }, match: { id: account.accountId } })
    })
  })

  const voucher = (extra: Record<string, unknown>) => {
    const c = code()
    return cy
      .task<{ id: string }[]>('db:insertRows', {
        table: 'gift_vouchers',
        rows: [{ account_id: account.accountId, code: c, kind: 'amount', value_cents: 5000, item_name: 'Saldo de 50 €', to_name: 'Andrés', from_name: 'Sara', deliver_to: 'buyer', buyer_email: 'sara@example.test', status: 'paid', paid_at: new Date().toISOString(), expires_at: inAYear(), ...extra }],
      })
      .then(() => cy.task<{ id: string }[]>('db:selectRows', { table: 'gift_vouchers', columns: 'id', match: { code: c } }))
      .then((rows) => ({ id: rows[0]!.id, code: c }))
  }

  it('is switched on in Settings and shown on the gift page; the payment webhook marks it paid, once', () => {
    cy.login(account.email, account.password)
    cy.visit('/settings/gift-vouchers')
    cy.get('[data-cy=gift-settings][data-ready=true]', { timeout: 20000 })
    cy.get('[data-cy=gift-enabled]').check()
    cy.get('input[aria-label="Amount in euros"]').type('75{enter}')
    cy.get('[data-cy=gift-settings-save]').click()
    cy.contains('Saved').should('be.visible')
    cy.task<{ enabled: boolean; amounts_cents: number[] }[]>('db:selectRows', { table: 'gift_voucher_settings', columns: 'enabled, amounts_cents', match: { account_id: account.accountId } })
      .its('0').should('deep.equal', { enabled: true, amounts_cents: [3000, 5000, 7500, 10000] })

    // The page offers what was set, and what it sends for an amount is the
    // amount and the people; the price is the server's (refused below).
    cy.intercept('POST', '/api/public-booking/gift-voucher', { statusCode: 200, body: { url: '/payment-done?status=success' } }).as('buy')
    cy.visit(`/regalo/${account.accountSlug}`)
    cy.get('[data-cy=gift-amount-7500]').should('contain', '75 €').click()
    cy.get('[data-cy=gift-preview]').should('have.text', '75 €')
    cy.get('[data-cy=gift-to]').type('Andrés')
    cy.get('[data-cy=gift-from]').type('Sara')
    cy.get('[data-cy=gift-recipient-email]').type('andres@example.test')
    cy.get('[data-cy=gift-buyer-email]').type('sara@example.test')
    cy.get('[data-cy=gift-pay]').click()
    cy.wait('@buy').its('request.body').should('deep.include', { slug: account.accountSlug, kind: 'amount', amountCents: 7500, toName: 'Andrés', fromName: 'Sara', deliverTo: 'recipient', recipientEmail: 'andres@example.test', buyerEmail: 'sara@example.test' })

    // An amount the clinic does not sell is refused by the server.
    cy.request({ method: 'POST', url: '/api/public-booking/gift-voucher', failOnStatusCode: false, body: { slug: account.accountSlug, kind: 'amount', amountCents: 1234, toName: 'A', fromName: 'B', deliverTo: 'buyer', buyerEmail: 'b@example.test' } })
      .its('status').should('eq', 400)

    // Paid: Stripe's webhook, signed with the clinic's secret.
    const secret = `whsec_cypress_${stamp()}`
    cy.task('db:insertRows', { table: 'account_secrets', rows: [{ account_id: account.accountId, name: 'stripe_webhook_secret', value: secret }, { account_id: account.accountId, name: 'stripe_secret_key', value: 'sk_test_cypress' }] })
    voucher({ status: 'pending', paid_at: null, expires_at: null }).then((v) => {
      const deliver = () => {
        const body = JSON.stringify({ id: `evt_${stamp()}`, object: 'event', type: 'payment_intent.succeeded', data: { object: { object: 'payment_intent', id: `pi_gift_${v.id.slice(0, 8)}`, amount_received: 5000, metadata: { gift_voucher_id: v.id, account_id: account.accountId } } } })
        return cy.task<{ header: string }>('auto:signStripe', { body, secret }).then(({ header }) =>
          cy.request({ method: 'POST', url: `/api/stripe/webhook/${account.accountId}`, body, headers: { 'content-type': 'application/json', 'stripe-signature': header } }).its('status').should('eq', 200),
        )
      }
      deliver()
      cy.task<{ status: string; paid_at: string; expires_at: string; stripe_payment_intent_id: string }[]>('db:selectRows', { table: 'gift_vouchers', columns: 'status, paid_at, expires_at, stripe_payment_intent_id', match: { id: v.id } }).its('0').then((row) => {
        expect(row.status).to.eq('paid')
        expect(row.stripe_payment_intent_id).to.match(/^pi_gift_/)
        const months = (Date.parse(row.expires_at) - Date.parse(row.paid_at)) / (30.4 * 24 * 3600 * 1000)
        expect(months).to.be.within(11.5, 12.5)
        // Delivered again: nothing moves.
        deliver()
        cy.task('db:selectRows', { table: 'gift_vouchers', columns: 'paid_at', match: { id: v.id } }).its('0.paid_at').should('eq', row.paid_at)
      })
      cy.task('db:selectRows', { table: 'payments', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 0)
      cy.visit(`/regalo/${account.accountSlug}?pagado=${v.id}`)
      cy.get('[data-cy=gift-paid]').should('contain', '¡Bono regalo pagado!')
    })
  })

  it('redeems an amount as credit at the desk, with its factura, and only once', () => {
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Andrés', lastName: 'Regalado' }).then((patient) => {
      voucher({}).then((v) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=money`)
        cy.get('[data-cy=redeem-gift-open]', { timeout: 20000 }).click()
        cy.get('[data-cy=redeem-gift-code]').type(v.code.toLowerCase().replace('-', ' '))
        cy.get('[data-cy=redeem-gift-submit]').click()
        cy.get('[data-cy=redeem-gift-done]').should('contain', 'Redeemed: 50 €')
        cy.task<{ amount_cents: number; method: string; purpose: string; external_reference: string; invoice_id: string | null }[]>('db:selectRows', { table: 'payments', columns: 'amount_cents, method, purpose, external_reference, invoice_id', match: { patient_id: patient.id } })
          .should('deep.equal', [{ amount_cents: 5000, method: 'card', purpose: 'on_account', external_reference: `regalo:${v.code}`, invoice_id: null }])
        cy.task<{ amount_cents: number; payment_id: string | null }[]>('db:selectRows', { table: 'account_credits', columns: 'amount_cents, payment_id', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.amount_cents).to.eq(5000)
          expect(rows[0]!.payment_id, 'the credit restates the payment').not.to.be.null
        })
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one factura for the money that came in').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(5000)
        })
        cy.task('db:selectRows', { table: 'gift_vouchers', columns: 'status', match: { id: v.id } }).its('0.status').should('eq', 'redeemed')
        // Again: refused, nothing recorded twice.
        cy.get('[data-cy=redeem-gift-code]').type(v.code)
        cy.get('[data-cy=redeem-gift-submit]').click()
        cy.get('[data-cy=redeem-gift-error]').should('contain', 'ya se ha canjeado')
        cy.task('db:selectRows', { table: 'payments', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 1)
      })
    })
  })

  it('redeems a bono voucher as that bono', () => {
    cy.task('db:insertRows', { table: 'packages', rows: [{ account_id: account.accountId, name: 'Bono 5 sesiones', session_count: 5, price_cents: 20000 }] })
    cy.task<{ id: string }[]>('db:selectRows', { table: 'packages', columns: 'id', match: { account_id: account.accountId } }).then((pkgs) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Bono' }).then((patient) => {
        voucher({ kind: 'package', package_id: pkgs[0]!.id, value_cents: 20000, item_name: 'Bono 5 sesiones' }).then((v) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=money`)
          cy.get('[data-cy=redeem-gift-open]', { timeout: 20000 }).click()
          cy.get('[data-cy=redeem-gift-code]').type(v.code)
          cy.get('[data-cy=redeem-gift-submit]').click()
          cy.get('[data-cy=redeem-gift-done]').should('contain', 'Bono 5 sesiones')
          cy.task<{ package_name: string; sessions_total: number; price_cents: number }[]>('db:selectRows', { table: 'package_purchases', columns: 'package_name, sessions_total, price_cents', match: { patient_id: patient.id } })
            .should('deep.equal', [{ package_name: 'Bono 5 sesiones', sessions_total: 5, price_cents: 20000 }])
          cy.task<{ purpose: string; amount_cents: number }[]>('db:selectRows', { table: 'payments', columns: 'purpose, amount_cents', match: { patient_id: patient.id } })
            .should('deep.equal', [{ purpose: 'bono', amount_cents: 20000 }])
          cy.task('db:facturasFor', { patientId: patient.id }).its('length').should('eq', 1)
        })
      })
    })
  })

  it('is redeemed by the patient when they book online with its code', () => {
    cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
    cy.task('db:insertRows', { table: 'gift_voucher_settings', rows: [{ account_id: account.accountId, enabled: true }] })
    cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', durationMinutes: 30, onlineBookingEnabled: true }).then(() => {
      voucher({}).then((v) => {
        cy.visit(`/book/${account.accountSlug}?regalo=${v.code}`)
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()
        cy.contains('Introduzca sus datos').should('be.visible')
        cy.get('[data-cy=booking-gift-ok]').should('contain', '50 € de saldo')
        cy.contains('label', 'Nombre *').parent().find('input').type('Nora')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type(`nora.regalo.${stamp()}@example.test`)
        cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111003')
        cy.contains('button', 'Reservar cita').click()
        cy.get('[data-cy=booking-gift-redeemed]', { timeout: 20000 }).should('contain', '50 €')
        cy.task<{ status: string; redeemed_payment_id: string }[]>('db:selectRows', { table: 'gift_vouchers', columns: 'status, redeemed_payment_id', match: { id: v.id } }).its('0').then((row) => {
          expect(row.status).to.eq('redeemed')
          cy.task<{ amount_cents: number; purpose: string }[]>('db:selectRows', { table: 'payments', columns: 'amount_cents, purpose', match: { id: row.redeemed_payment_id } })
            .should('deep.equal', [{ amount_cents: 5000, purpose: 'on_account' }])
        })
      })
    })
  })

  it('refuses a code that is unknown, unpaid or expired', () => {
    const check = (c: string) => cy.request('POST', '/api/public-booking/gift-check', { slug: account.accountSlug, code: c }).its('body')
    check('REGALO-NOPE99').should('deep.include', { ok: false, message: 'Ese código no existe.' })
    voucher({ status: 'pending', paid_at: null }).then((v) => check(v.code).should('deep.include', { ok: false, message: 'Ese bono regalo aún no está pagado.' }))
    voucher({ expires_at: new Date(Date.now() - 86400000).toISOString() }).then((v) => check(v.code).should('deep.include', { ok: false, message: 'Ese bono regalo ha caducado.' }))
  })
})
