// POST /api/public/v1/whatsapp/send addressed by "to".
//
// The docs ask for an E.164 number, and E.164 is written with a "+". The
// endpoint found the patient behind a number by comparing toE164() -- which
// returns digits only -- against "to" exactly as given, so "+34612..." never
// matched anybody. That skipped the under-age and do-not-contact refusals
// entirely, missed the 24h window (inbound rows hold Meta's digits), and
// stored the outbound row under a number no thread is keyed by.
//
// Only the refusals are exercised here: a send that gets past them goes to
// graph.facebook.com, which whatsappSend.ts does not route to the local stub.
// The normalisation itself is pinned in tests/unit/whatsapp-digits.test.ts.

interface Account {
  accountId: string
  clinicId: string
}

let token = ''

function send(body: Record<string, unknown>) {
  return cy.request({
    method: 'POST',
    url: '/api/public/v1/whatsapp/send',
    headers: { authorization: `Bearer ${token}` },
    body,
    failOnStatusCode: false,
  })
}

function setup(then: (account: Account, local: string) => void) {
  const local = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  cy.seedStaffAccount().then((account) => {
    cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId: `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}` })
    cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'wa-test-token' })
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['whatsapp:send'] }).then((tok) => {
      token = tok.token
      then(account as Account, local)
    })
  })
}

// "+34 612 34 56 78" -- the way a person writes one, spaces and all.
const spaced = (local: string) => `+34 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`

describe('Public API WhatsApp send, addressed by number', () => {
  it('refuses a minor even when the number is written with a "+"', () => {
    setup((account, local) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', phone: local }).then((patient) => {
        cy.task('db:setPatientContactFlags', { patientId: patient.id, isMinor: true })
        // A template, which needs no open window -- so the only thing that
        // can stop this send is the patient's own flag. Before, it went on to
        // Meta.
        send({ to: spaced(local), template_name: 'recordatorio_cita' }).then((res) => {
          expect(res.status).to.eq(400)
          expect(JSON.stringify(res.body)).to.contain('cannot be contacted')
        })
      })
    })
  })

  it('refuses somebody marked do-not-contact the same way', () => {
    setup((account, local) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nuria', phone: local }).then((patient) => {
        cy.task('db:setPatientContactFlags', { patientId: patient.id, doNotContact: true })
        send({ to: `+34${local}`, template_name: 'recordatorio_cita' }).then((res) => {
          expect(res.status).to.eq(400)
          expect(JSON.stringify(res.body)).to.contain('cannot be contacted')
        })
      })
    })
  })
})
