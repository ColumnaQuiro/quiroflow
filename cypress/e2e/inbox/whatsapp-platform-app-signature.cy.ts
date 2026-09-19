// Two kinds of clinic post to the same webhook, and they prove themselves
// with different secrets.
//
// A clinic onboarded through Embedded Signup never creates a Meta app, so it
// has no app secret of its own and never will -- Meta signs its webhooks with
// the QuiroFlow Tech Provider app's secret, shared by every such clinic. A
// clinic that pasted its own tokens into Settings (Columnaquiro) has its own
// app and its own row in whatsapp_app_secrets.
//
// webhookMayActOnAccount tries the platform secret first, then falls back to
// the per-account row. The fallback is the whole point: it is what lets the
// platform app go through App Review and be rolled out without a flag day, so
// "the direct clinics still work" is as important to hold here as the new
// path working at all.

const platformSecret = Cypress.env('META_PLATFORM_APP_SECRET') as string | undefined

let phoneNumberId = ''
let phone = ''

function payload() {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from: `34${phone}`, type: 'text', text: { body: 'Hola' } }],
            },
          },
        ],
      },
    ],
  }
}

/** Posts pre-serialised bytes, so a signature over them stays valid. */
function post(body: string, signature: string, failOnStatusCode = true) {
  return cy.request({
    method: 'POST',
    url: '/api/whatsapp/webhook',
    body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    failOnStatusCode,
  })
}

function deliverSignedWith(secret: string, failOnStatusCode = true) {
  const body = JSON.stringify(payload())
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret: secret }).then((signed) => post(body, signed.signature, failOnStatusCode))
}

/**
 * `ownAppSecret: null` is the Embedded Signup clinic -- no row at all, which
 * is exactly the state that used to be unconditionally refused.
 */
function seed(ownAppSecret: string | null, then: (patientId: string) => void) {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

  cy.seedStaffAccount().then((account) => {
    cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Plataforma' }).then((patient: any) => {
      if (ownAppSecret) cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret: ownAppSecret })
      cy.task('db:seedWhatsappReplyScenario', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        patientId: patient.id,
        phoneNumberId,
        phone,
        confirmationStatus: null,
      }).then(() => then(patient.id))
    })
  })
}

const inboundCount = (patientId: string, count: number) => cy.task('db:inboundMessages', { patientId }).should('have.length', count)

describe('Verifying a webhook against the platform Meta app', () => {
  // Skipped rather than failed when the secret is absent, because unset is a
  // legitimate production configuration -- every clinic direct -- not a
  // broken test environment. The fallback tests below still run, and they are
  // the ones that must never regress.
  const describePlatform = platformSecret ? describe : describe.skip

  describePlatform('a clinic with no app secret of its own', () => {
    it('is accepted when Meta signs with the platform secret', () => {
      seed(null, (patientId) => {
        deliverSignedWith(platformSecret!).its('status').should('eq', 200)
        // The message actually landed: a 200 that quietly dropped the payload
        // would pass an auth assertion while delivering nothing.
        inboundCount(patientId, 1)
      })
    })

    it('is still refused when the signature is from neither secret', () => {
      seed(null, (patientId) => {
        deliverSignedWith('f'.repeat(32), false).its('status').should('eq', 401)
        inboundCount(patientId, 0)
      })
    })
  })

  describe('a clinic that pasted its own tokens', () => {
    // The no-flag-day guarantee. Columnaquiro is this clinic, and it must keep
    // working unchanged for the whole time the platform app is in review.
    it('is accepted on its own app secret, platform secret configured or not', () => {
      const own = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
      seed(own, (patientId) => {
        deliverSignedWith(own).its('status').should('eq', 200)
        inboundCount(patientId, 1)
      })
    })

    it('is refused when signed with some other clinic’s secret', () => {
      seed('a1b2c3d4e5f60718293a4b5c6d7e8f90', (patientId) => {
        deliverSignedWith('0'.repeat(32), false).its('status').should('eq', 401)
        inboundCount(patientId, 0)
      })
    })
  })
})
