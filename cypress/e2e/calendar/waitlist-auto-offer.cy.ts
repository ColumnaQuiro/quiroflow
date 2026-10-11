import type { StaffAccount } from '../../support/commands'

// How a freed slot reaches the waitlist (accounts.waitlist_auto_offer and
// waitlist_offer_mode): everyone who fits at once, the first to accept books
// it and the rest stay on the list; a moved visit offers the time it left
// when the clinic asks for that; and the setting itself on the Waitlist page.

/** Tomorrow at noon, local: far enough off for a full two-hour offer. */
function tomorrowAt(hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}
const cron = () => cy.request({ method: 'POST', url: '/api/waitlist/expire-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
type Entry = { id: string; status: string; claim_token: string | null; offered_to_all: boolean; offered_starts_at: string | null }
const entries = (accountId: string) =>
  cy.task<Entry[]>('db:selectRows', { table: 'waitlist_entries', columns: 'id, status, claim_token, offered_to_all, offered_starts_at', match: { account_id: accountId } })

function seed(settings: { waitlist_auto_offer?: boolean; waitlist_offer_mode?: string }) {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:updateRows', { table: 'accounts', values: settings, match: { id: account.accountId } })
    const patient = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Prueba' })
    return patient('Visita').then((visit) =>
      cy
        .task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: visit.id, practitionerId: account.teamMemberId, startsAt: tomorrowAt(12).toISOString() })
        .then((appt) =>
          patient('Ana').then((a) =>
            patient('Bea').then((b) => {
              cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: a.id, createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString() })
              cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: b.id, createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })
              return cy.wrap({ account, appointmentId: appt.id })
            }),
          ),
        ),
    )
  })
}
const offerNext = (account: StaffAccount, body: object) =>
  cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) =>
    cy.request({ method: 'POST', url: '/api/waitlist/offer-next', headers: { Authorization: `Bearer ${token}` }, body }),
  )

describe('Waitlist, everyone at once', () => {
  it('offers the slot to everyone who fits, books the first to accept and keeps the rest waiting', () => {
    seed({ waitlist_offer_mode: 'all_at_once' }).then(({ account, appointmentId }) => {
      cy.task('db:updateRows', { table: 'appointments', values: { status: 'cancelled' }, match: { id: appointmentId } })
      offerNext(account, { appointmentId }).its('body').should('deep.eq', { offered: true, count: 2 })
      entries(account.accountId).then((rows) => {
        expect(rows.map((r) => r.status)).to.deep.equal(['offered', 'offered'])
        expect(rows.every((r) => r.offered_to_all)).to.equal(true)
        expect(new Set(rows.map((r) => r.claim_token)).size).to.equal(2)

        const [first, second] = rows
        cy.request({ method: 'POST', url: `/api/waitlist/${second!.claim_token}` }).its('body.success').should('eq', true)
        cy.task<Entry[]>('db:selectRows', { table: 'waitlist_entries', columns: 'id, status, claim_token, offered_to_all, offered_starts_at', match: { id: first!.id } }).then(([r]) => {
          expect(r!.status).to.equal('waiting')
          expect(r!.claim_token).to.equal(null)
        })
        // Their link stops working.
        cy.request({ method: 'POST', url: `/api/waitlist/${first!.claim_token}`, failOnStatusCode: false }).its('status').should('eq', 404)
      })
    })
  })

  it('puts everyone back to waiting when nobody accepts in time, without re-offering', () => {
    seed({ waitlist_offer_mode: 'all_at_once' }).then(({ account, appointmentId }) => {
      cy.task('db:updateRows', { table: 'appointments', values: { status: 'cancelled' }, match: { id: appointmentId } })
      offerNext(account, { appointmentId }).its('body.count').should('eq', 2)
      cy.task('db:updateRows', { table: 'waitlist_entries', values: { offer_expires_at: new Date(Date.now() - 60_000).toISOString() }, match: { account_id: account.accountId } })
      cron().its('status').should('eq', 200)
      entries(account.accountId).then((rows) => {
        expect(rows.map((r) => r.status)).to.deep.equal(['waiting', 'waiting'])
        expect(rows.every((r) => !r.offered_to_all && !r.claim_token)).to.equal(true)
      })
    })
  })

  it('still offers one at a time by default', () => {
    seed({}).then(({ account, appointmentId }) => {
      cy.task('db:updateRows', { table: 'appointments', values: { status: 'cancelled' }, match: { id: appointmentId } })
      offerNext(account, { appointmentId }).its('body').should('deep.eq', { offered: true, count: 1 })
    })
  })
})

describe('Waitlist, a moved visit', () => {
  function move(account: StaffAccount, appointmentId: string) {
    const from = tomorrowAt(12).toISOString()
    cy.task('db:updateRows', { table: 'appointments', values: { starts_at: tomorrowAt(16).toISOString(), ends_at: new Date(tomorrowAt(16).getTime() + 30 * 60000).toISOString(), rescheduled: true }, match: { id: appointmentId } })
    cy.task('db:insertRows', { table: 'appointment_reschedules', rows: [{ account_id: account.accountId, appointment_id: appointmentId, from_starts_at: from, to_starts_at: tomorrowAt(16).toISOString(), created_by: account.teamMemberId }] })
    return offerNext(account, { appointmentId, movedFrom: from })
  }

  it('offers the time it left when the clinic offers freed slots automatically', () => {
    seed({ waitlist_auto_offer: true }).then(({ account, appointmentId }) => {
      move(account, appointmentId).its('body').should('deep.eq', { offered: true, count: 1 })
      entries(account.accountId).then((rows) => {
        const offered = rows.find((r) => r.status === 'offered')!
        expect(Date.parse(offered.offered_starts_at!)).to.equal(tomorrowAt(12).getTime())
      })
    })
  })

  it('offers nothing for a move when the clinic has not asked for it', () => {
    seed({}).then(({ account, appointmentId }) => {
      move(account, appointmentId).its('body.offered').should('eq', false)
      entries(account.accountId).then((rows) => expect(rows.every((r) => r.status === 'waiting')).to.equal(true))
    })
  })
})

describe('Waitlist, a cancellation nobody at the desk made', () => {
  const cancelByApi = (account: StaffAccount, appointmentId: string) =>
    cy
      .task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:write', 'appointments:read'] })
      .then(({ token }) => cy.request({ method: 'DELETE', url: `/api/public/v1/appointments/${appointmentId}`, headers: { Authorization: `Bearer ${token}` } }))

  it('offers the slot when the clinic offers freed slots automatically', () => {
    seed({ waitlist_auto_offer: true }).then(({ account, appointmentId }) => {
      cancelByApi(account, appointmentId).its('status').should('eq', 200)
      entries(account.accountId).then((rows) => expect(rows.filter((r) => r.status === 'offered')).to.have.length(1))
    })
  })

  it('leaves it free otherwise', () => {
    seed({}).then(({ account, appointmentId }) => {
      cancelByApi(account, appointmentId).its('status').should('eq', 200)
      entries(account.accountId).then((rows) => expect(rows.every((r) => r.status === 'waiting')).to.equal(true))
    })
  })
})

describe('Waitlist, the setting', () => {
  it('is changed on the Waitlist page, and says when no automation would tell anyone', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/waitlist')
      cy.get('[data-cy=waitlist-offer-settings]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=waitlist-no-message]').should('be.visible')
      cy.get('[data-cy=waitlist-auto-offer]').check()
      cy.get('[data-cy=waitlist-mode-all]').click()
      cy.get('[data-cy=waitlist-offer-save]').click()
      cy.task<{ waitlist_auto_offer: boolean; waitlist_offer_mode: string }[]>('db:selectRows', { table: 'accounts', columns: 'waitlist_auto_offer, waitlist_offer_mode', match: { id: account.accountId } }).then(([a]) => {
        expect(a!.waitlist_auto_offer).to.equal(true)
        expect(a!.waitlist_offer_mode).to.equal('all_at_once')
      })
    })
  })
})
