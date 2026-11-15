// The public API does what developers.quiroflow.com says it does.
//
// Each case here was a gap between the portal and the code, found reviewing
// the API before a clinic integrated with it (13 Nov 2026):
//
// - POST /appointments booked into blocked time -- a closure, a public
//   holiday, a practitioner's leave -- although GET /availability leaves it out.
// - POST /patients refused every local phone number: phone_country_code
//   defaulted to "+34", which is not a country code QuiroFlow knows.
// - preferred_language took only es/en; the app also has ca and fr.
// - ?from= on a list endpoint was silently ignored and returned everything.
// - A page past the end was a 500, and a duplicate external_reference on an
//   appointment was a 500 where the docs promise 409.
// - WhatsApp send took another account's patient_id and recorded it.

const HOUR = 3600 * 1000

describe('Public API contract', () => {
  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
  })

  function headers(account: any, scopes: string[]) {
    return cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes }).then(({ token }) => ({ Authorization: `Bearer ${token}` }))
  }

  function patient(account: any, firstName: string) {
    return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Contrato' })
  }

  /** A slot `days` ahead at `hour`:00 UTC. */
  function slot(days: number, hour: number) {
    const start = new Date(Date.now() + days * 24 * HOUR)
    start.setUTCHours(hour, 0, 0, 0)
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60000).toISOString() }
  }

  it('refuses to book into a clinic closure, and books beside it', () => {
    cy.get('@acct').then((account: any) => {
      headers(account, ['appointments:write']).then((auth) => {
        patient(account, 'Bloqueo').then((p) => {
          const closed = slot(9, 10)
          cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: closed.startsAt, endsAt: closed.endsAt, note: 'Festivo' })
          const body = { patient_id: p.id, clinic_id: account.clinicId, practitioner_id: account.teamMemberId }

          cy.request({ method: 'POST', url: '/api/public/v1/appointments', headers: auth, failOnStatusCode: false, body: { ...body, starts_at: closed.startsAt, ends_at: closed.endsAt } }).then((res) => {
            expect(res.status).to.eq(409)
            expect(res.body.error.code).to.eq('conflict')
            expect(res.body.error.field).to.eq('starts_at')
          })
          cy.task<unknown[]>('db:selectRows', { table: 'appointments', columns: 'id', match: { patient_id: p.id } }).should('have.length', 0)

          const open = slot(9, 12)
          cy.request({ method: 'POST', url: '/api/public/v1/appointments', headers: auth, body: { ...body, starts_at: open.startsAt, ends_at: open.endsAt, external_reference: 'ext-1' } })
            .its('status')
            .should('eq', 201)

          // The same external_reference again is the 409 the docs promise,
          // not a 500 -- what makes a retried create safe.
          const later = slot(10, 12)
          cy.request({ method: 'POST', url: '/api/public/v1/appointments', headers: auth, failOnStatusCode: false, body: { ...body, starts_at: later.startsAt, ends_at: later.endsAt, external_reference: 'ext-1' } }).then((res) => {
            expect(res.status).to.eq(409)
            expect(res.body.error.field).to.eq('external_reference')
          })
        })
      })
    })
  })

  it('creates a patient with a local phone number and a Catalan language preference', () => {
    cy.get('@acct').then((account: any) => {
      headers(account, ['patients:write', 'patients:read']).then((auth) => {
        cy.request({ method: 'POST', url: '/api/public/v1/patients', headers: auth, body: { first_name: 'Local', phone: '612 345 678', preferred_language: 'ca' } }).then((res) => {
          expect(res.status).to.eq(201)
          expect(res.body.data.preferred_language).to.eq('ca')
          cy.task<{ number: string; country_code: string }[]>('db:selectRows', { table: 'patient_contact_numbers', columns: 'number, country_code', match: { patient_id: res.body.data.id } }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.country_code).to.eq('ES')
            expect(rows[0]!.number.replace(/\D/g, '')).to.eq('612345678')
          })
        })

        // An international number is stored as country + national number,
        // the way every screen in QuiroFlow writes it.
        cy.request({ method: 'POST', url: '/api/public/v1/patients', headers: auth, body: { first_name: 'Lisboa', phone: '+351 912 345 678' } }).then((res) => {
          cy.task<{ number: string; country_code: string }[]>('db:selectRows', { table: 'patient_contact_numbers', columns: 'number, country_code', match: { patient_id: res.body.data.id } }).then((rows) => {
            expect(rows[0]!.country_code).to.eq('PT')
            expect(rows[0]!.number).to.eq('912345678')
          })
        })

        // The dial-code form the docs used to show still works.
        cy.request({ method: 'POST', url: '/api/public/v1/patients', headers: auth, body: { first_name: 'Prefijo', phone: '612345679', phone_country_code: '+34' } }).its('status').should('eq', 201)

        cy.request({ method: 'POST', url: '/api/public/v1/patients', headers: auth, failOnStatusCode: false, body: { first_name: 'Corto', phone: '61' } }).then((res) => {
          expect(res.status).to.eq(400)
          expect(res.body.error.field).to.eq('phone')
        })
      })
    })
  })

  it('rejects ?from= on a list instead of returning everything, and answers a page past the end with an empty page', () => {
    cy.get('@acct').then((account: any) => {
      headers(account, ['appointments:read']).then((auth) => {
        cy.request({ url: '/api/public/v1/appointments', headers: auth, qs: { from: '2026-03-01' }, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(400)
          expect(res.body.error.code).to.eq('invalid_request')
        })
        cy.request({ url: '/api/public/v1/appointments', headers: auth, qs: { page: 999 } }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.data).to.deep.eq([])
          expect(res.body.links.next).to.eq(null)
        })
      })
    })
  })

  it('refuses a WhatsApp send for another account’s patient', () => {
    cy.seedStaffAccount().then((other: any) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ajeno', lastName: 'Otra' }).then((foreign) => {
        cy.get('@acct').then((account: any) => {
          headers(account, ['whatsapp:send']).then((auth) => {
            cy.request({ method: 'POST', url: '/api/public/v1/whatsapp/send', headers: auth, failOnStatusCode: false, body: { patient_id: foreign.id, text: 'hola' } }).then((res) => {
              expect(res.status).to.eq(400)
              expect(res.body.error.field).to.eq('patient_id')
            })
            cy.request({ method: 'POST', url: '/api/public/v1/whatsapp/send', headers: auth, failOnStatusCode: false, body: { patient_id: 'not-a-uuid', text: 'hola' } }).its('status').should('eq', 400)
          })
        })
      })
    })
  })
})
