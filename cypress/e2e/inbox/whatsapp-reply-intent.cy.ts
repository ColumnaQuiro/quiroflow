// What an inbound WhatsApp message is allowed to do to an appointment, and --
// since it used to be able to do it with no credentials at all -- who is
// allowed to send one in the first place.
//
// Two ways a request proves it is genuine, because the clinics run two setups:
// Meta posting directly (it signs the raw bytes) and Meta posting to n8n which
// forwards on (the signature cannot survive re-serialising, so the forwarder
// authenticates with a scoped QuiroFlow token instead).

// Fresh per test, and that matters more than it looks: the webhook finds the
// account with .maybeSingle() on whatsapp_phone_number_id, so two accounts
// sharing one id match two rows, resolve to none, and the endpoint quietly
// does nothing. Specs seed a new account each time and the database is not
// reset between them, so a shared constant here made every test after the
// first assert against a webhook that had silently no-opped -- including two
// that "passed" because they expect a status to stay where it was.
let phoneNumberId = ''
let phone = ''
let appSecret = ''
let apiToken = ''

const APP_SECRET_LENGTH = 32

function payload(message: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from: `34${phone}`, ...message }],
            },
          },
        ],
      },
    ],
  }
}

/** Posts pre-serialised bytes, so a signature over them stays valid. */
function post(body: string, headers: Record<string, string>, failOnStatusCode = true) {
  return cy.request({
    method: 'POST',
    url: '/api/whatsapp/webhook',
    body,
    headers: { 'content-type': 'application/json', ...headers },
    failOnStatusCode,
  })
}

/** The way Meta itself calls: signed with the clinic's app secret. */
function deliverSigned(message: Record<string, unknown>) {
  const body = JSON.stringify(payload(message))
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) => {
    return post(body, { 'x-hub-signature-256': signed.signature })
  })
}

/** The way a forwarder calls: its own token, no usable Meta signature. */
function deliverForwarded(message: Record<string, unknown>) {
  return post(JSON.stringify(payload(message)), { authorization: `Bearer ${apiToken}` })
}

const textMessage = (body: string) => ({ type: 'text', text: { body } })
// How Meta reports a tap on one of the reminder template's buttons: the
// button's own title, not something the patient typed.
const buttonMessage = (title: string) => ({ type: 'button', button: { text: title } })

const deliverText = (body: string) => deliverSigned(textMessage(body))
const deliverButton = (title: string) => deliverSigned(buttonMessage(title))

function statusOf(appointmentId: string) {
  return cy.task('db:appointmentById', { appointmentId }).its('confirmation_status')
}

// For the cases that assert a status did NOT move: the webhook has to have
// seen the message and declined to act on it, which is a different thing
// from the webhook never running. It stores every inbound message before it
// looks at intent, so the row is the evidence.
function assertWebhookProcessed(patientId: string, count: number) {
  cy.task('db:inboundMessages', { patientId }).should('have.length', count)
}

function seed(confirmationStatus: 'pending' | 'confirmed' | null, then: (appointmentId: string, patientId: string, accountId: string) => void) {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')

  cy.seedStaffAccount().then((account) => {
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Adrian',
      lastName: 'Replies',
    }).then((patient: any) => {
      cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['whatsapp:webhook'] }).then((tok) => {
        apiToken = tok.token
      })
      cy.task('db:seedWhatsappReplyScenario', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        patientId: patient.id,
        phoneNumberId,
        phone,
        confirmationStatus,
      }).then((appt: any) => then(appt.id, patient.id, account.accountId))
    })
  })
}

describe('Who may post to the WhatsApp webhook', () => {
  it('refuses a request carrying no proof at all', () => {
    // The hole this closes: exactly this request could cancel a patient's
    // appointment, which then fired the cancellation automation and messaged
    // them about a cancellation they never asked for.
    seed(null, (appointmentId) => {
      post(JSON.stringify(payload(buttonMessage('Cancelar'))), {}, false).its('status').should('eq', 401)
      cy.task('db:appointmentById', { appointmentId }).its('status').should('eq', 'booked')
      statusOf(appointmentId).should('be.null')
    })
  })

  it('refuses a signature computed with the wrong secret', () => {
    seed(null, (appointmentId, patientId) => {
      const body = JSON.stringify(payload(buttonMessage('Confirmar')))
      cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret: 'f'.repeat(APP_SECRET_LENGTH) }).then((signed) => {
        post(body, { 'x-hub-signature-256': signed.signature })
      })
      // Nothing is persisted either: the gate sits ahead of the insert, so
      // forged content never reaches the clinic's inbox at all. That is the
      // point -- injecting invented messages attributed to a real patient was
      // half of what this endpoint allowed.
      assertWebhookProcessed(patientId, 0)
      statusOf(appointmentId).should('be.null')
    })
  })

  it('refuses a signature over different bytes than were sent', () => {
    // What a forwarder that re-serialises the JSON looks like from here, and
    // the reason forwarders get a token instead of relaying the signature.
    seed(null, (appointmentId) => {
      const signedBody = JSON.stringify(payload(buttonMessage('Confirmar')))
      cy.task<{ signature: string }>('db:signWhatsappBody', { body: signedBody, appSecret }).then((signed) => {
        post(`${signedBody} `, { 'x-hub-signature-256': signed.signature })
      })
      statusOf(appointmentId).should('be.null')
    })
  })

  it('accepts a forwarder holding a whatsapp:webhook token', () => {
    seed(null, (appointmentId) => {
      deliverForwarded(buttonMessage('Confirmar'))
      statusOf(appointmentId).should('eq', 'confirmed')
    })
  })

  it('refuses a token without the whatsapp:webhook scope', () => {
    seed(null, (appointmentId, _patientId, accountId) => {
      cy.task<{ token: string }>('db:createApiToken', { accountId, scopes: ['whatsapp:send'] }).then((tok) => {
        post(JSON.stringify(payload(buttonMessage('Confirmar'))), { authorization: `Bearer ${tok.token}` }, false)
          .its('status')
          .should('eq', 403)
      })
      statusOf(appointmentId).should('be.null')
    })
  })

  it("refuses a valid token belonging to a different clinic", () => {
    // The token path resolves the account from the token, so a forwarder
    // cannot act for a clinic other than its own even though the body names
    // one -- the flaw the old code had, where the body decided everything.
    seed(null, (appointmentId) => {
      cy.seedStaffAccount().then((other) => {
        cy.task<{ token: string }>('db:createApiToken', { accountId: other.accountId, scopes: ['whatsapp:webhook'] }).then((tok) => {
          post(JSON.stringify(payload(buttonMessage('Confirmar'))), { authorization: `Bearer ${tok.token}` })
        })
        statusOf(appointmentId).should('be.null')
      })
    })
  })

  it('refuses everything for a clinic with no app secret stored', () => {
    // Fail-closed: this is the documented consequence of the change, and the
    // reason Settings > WhatsApp shows whether a secret is set.
    seed(null, (appointmentId, _patientId, accountId) => {
      cy.task('db:clearWhatsappAppSecret', { accountId })
      const body = JSON.stringify(payload(buttonMessage('Confirmar')))
      cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) => {
        post(body, { 'x-hub-signature-256': signed.signature })
      })
      statusOf(appointmentId).should('be.null')
    })
  })
})

describe('What a WhatsApp reply does to an appointment', () => {
  it('reads the reminder buttons as the answers they are', () => {
    seed(null, (appointmentId) => {
      deliverButton('Confirmar')
      statusOf(appointmentId).should('eq', 'confirmed')
    })
  })

  it('does not read a request to change an email address as a request to move the appointment', () => {
    // The message that started this. Sent fourteen minutes after tapping
    // Confirmar, it asked to change an EMAIL ADDRESS -- but "cambiar" matched
    // on its own, so the calendar showed a patient who had just confirmed as
    // wanting to reschedule.
    seed(null, (appointmentId, patientId) => {
      deliverText('Me gustaría cambiar el Mail que tenéis registrado con mi ficha a: nuevo@example.com')
      assertWebhookProcessed(patientId, 1)
      statusOf(appointmentId).should('be.null')
    })
  })

  it('still reads a real request that names the appointment only as "la"', () => {
    // The reason the fix above excludes by what is being changed rather than
    // by where the word sits: these are replies to a reminder, so they lean on
    // it for the object and would be lost by any start-of-message rule.
    seed('pending', (appointmentId) => {
      deliverText('Me la puedes cambiar por la tarde si hay sitio a partir de las 19:15')
      statusOf(appointmentId).should('eq', 'reschedule_requested')
    })
  })

  it('lets someone take back a mis-tap instead of re-triggering it', () => {
    seed(null, (appointmentId, patientId) => {
      deliverButton('Cambiar cita')
      statusOf(appointmentId).should('eq', 'reschedule_requested')

      // "Sorry!! I pressed change appointment by accident." This used to
      // re-flag the appointment, so no wording could undo an accidental tap.
      deliverText('Perdon!! Le di a cambiar cita sin querer')
      assertWebhookProcessed(patientId, 2)
      statusOf(appointmentId).should('eq', 'reschedule_requested')
    })
  })

  it('does not let a passing sentence overturn an answer the patient already gave', () => {
    seed('confirmed', (appointmentId, patientId) => {
      deliverText('Cambiar de tema, muchas gracias por todo')
      assertWebhookProcessed(patientId, 1)
      statusOf(appointmentId).should('eq', 'confirmed')
    })
  })

  it('still lets the patient change their mind by tapping the other button', () => {
    seed('confirmed', (appointmentId) => {
      deliverButton('Cambiar cita')
      statusOf(appointmentId).should('eq', 'reschedule_requested')
    })
  })

  // No comma after "Confirmar" on purpose. The confirm branch counts a
  // keyword only when a space or "!" follows it, and that narrowness is worth
  // keeping: accepting a comma would read "Sí, entiendo perfectamente...
  // necesito hacer esta pausa" -- a patient stopping treatment -- as
  // confirming their next appointment.
  it('still takes a typed answer while the question is open', () => {
    seed('pending', (appointmentId) => {
      deliverText('Confirmar nos vemos el lunes')
      statusOf(appointmentId).should('eq', 'confirmed')
    })
  })
})
