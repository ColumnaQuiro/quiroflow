// What an inbound WhatsApp message is allowed to do to an appointment's
// confirmation status. Patients don't stop writing once they have answered --
// they thank reception, ask about their email address, take back a mis-tap --
// and every one of those messages runs through the same classifier.

// Fresh per test, and that matters more than it looks: the webhook finds the
// account with .maybeSingle() on whatsapp_phone_number_id, so two accounts
// sharing one id match two rows, resolve to none, and the endpoint quietly
// does nothing. Specs seed a new account each time and the database is not
// reset between them, so a shared constant here made every test after the
// first assert against a webhook that had silently no-opped -- including two
// that "passed" because they expect a status to stay where it was.
let phoneNumberId = ''
let phone = ''

function deliver(message: Record<string, unknown>) {
  return cy.request('POST', '/api/whatsapp/webhook', {
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
  })
}

const deliverText = (body: string) => deliver({ type: 'text', text: { body } })
// How Meta reports a tap on one of the reminder template's buttons: the
// button's own title, not something the patient typed.
const deliverButton = (title: string) => deliver({ type: 'button', button: { text: title } })

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

function seed(confirmationStatus: 'pending' | 'confirmed' | null, then: (appointmentId: string, patientId: string) => void) {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  cy.seedStaffAccount().then((account) => {
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Adrian',
      lastName: 'Replies',
    }).then((patient: any) => {
      cy.task('db:seedWhatsappReplyScenario', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        patientId: patient.id,
        phoneNumberId,
        phone,
        confirmationStatus,
      }).then((appt: any) => then(appt.id, patient.id))
    })
  })
}

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
