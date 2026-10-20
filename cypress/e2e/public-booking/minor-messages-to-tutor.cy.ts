// A minor's automatic messages go to their tutor. A minor is never messaged
// themselves, and until Oct 2026 that was the whole rule: their confirmation
// and reminder went to nobody, even when patients.tutor_patient_id named the
// parent's own record. Now the tutor's number and email receive them, under
// the tutor's own do-not-contact flag, naming the minor ({{1}}) so the parent
// knows whose appointment it is. Against the Meta Graph stub, as
// automatic-confirmations.cy.ts.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const hours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString()
const weekAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
const randomPhone = () => `+346${Math.floor(10000000 + Math.random() * 89999999)}`
const APP_SECRET_LENGTH = 32

function templates() {
  return cy.task('db:startMetaGraphStub', {
    templates: [{ name: 'confirmacion_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}, te recordamos tu cita el día {{2}} a las {{3}}h.' }],
  })
}

function person(account: Account, firstName: string, opts: { phone?: boolean; email?: string } = {}) {
  const phone = randomPhone()
  return cy
    .task<{ id: string }>('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName,
      ...(opts.phone === false ? {} : { phone }),
      ...(opts.email ? { email: opts.email } : {}),
    })
    .then((p) => ({ id: p.id, phone }))
}

/** A minor, with their own number on file (which must never be used), and their tutor if given. */
function minor(account: Account, tutorId: string | null) {
  return person(account, 'Lucía').then((child) => {
    cy.task('db:setPatientContactFlags', { patientId: child.id, isMinor: true })
    if (tutorId) cy.task('db:setPatientTutor', { patientId: child.id, tutorPatientId: tutorId })
    return cy.wrap(child)
  })
}

const sendsTo = (phone: string) => cy.task<any[]>('db:metaGraphStubSends').then((all) => all.filter((m) => m?.to === phone.replace(/\D/g, '')))

// By default inside the 24-hour reminder window, booked by staff a week ago.
// `online` is a booking made from the public page just now.
function booking(account: Account, patientId: string, online = false) {
  return cy.task<{ id: string }>('db:createAppointment', {
    accountId: account.accountId,
    clinicId: account.clinicId,
    patientId,
    ...(online ? { startsAt: hours(48), source: 'online' } : { startsAt: hours(20), source: 'staff', createdAt: weekAgo() }),
  })
}

const state = (appointmentId: string) => cy.task<{ reminder_sent_at: string | null }>('db:appointmentMessageState', { appointmentId })
const runCron = () =>
  cy.request({ method: 'POST', url: '/api/automations/appointment-reminders-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })

describe("A minor's automatic messages go to their tutor", () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as Account
      cy.task('db:setAutomaticMessages', { accountId: account.accountId, confirmation: false, reminder: true, reminderHoursBefore: 24 })
      templates()
    })
  })

  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it("reminds the tutor, on the tutor's number, naming the minor -- and a Confirmar from the tutor confirms the minor's visit", () => {
    person(account, 'Marta').then((tutor) =>
      minor(account, tutor.id).then((child) =>
        booking(account, child.id).then((appt) => {
          runCron()
          state(appt.id).its('reminder_sent_at').should('not.eq', null)
          sendsTo(child.phone).should('have.length', 0)
          sendsTo(tutor.phone).then((sends) => {
            expect(sends).to.have.length(1)
            expect(sends[0].template.components[0].parameters[0].text, 'whose appointment').to.eq('Lucía')
          })
          // Filed in the tutor's thread, still naming the minor's visit.
          cy.task<{ patient_id: string; appointment_id: string }[]>('db:selectRows', {
            table: 'whatsapp_messages',
            columns: 'patient_id, appointment_id',
            match: { appointment_id: appt.id },
          }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.patient_id).to.eq(tutor.id)
          })

          // The tutor taps Confirmar: the reply arrives on the tutor's record,
          // and is about the minor's appointment.
          const appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
          cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
          cy.task<{ whatsapp_phone_number_id: string }[]>('db:selectRows', { table: 'accounts', columns: 'whatsapp_phone_number_id', match: { id: account.accountId } }).then((acc) => {
            const body = JSON.stringify({
              entry: [
                {
                  changes: [
                    {
                      value: {
                        metadata: { phone_number_id: acc[0]!.whatsapp_phone_number_id },
                        messages: [{ id: `wamid.${Date.now()}`, from: tutor.phone.replace(/\D/g, ''), type: 'button', button: { text: 'Confirmar' } }],
                      },
                    },
                  ],
                },
              ],
            })
            cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
              cy.request({ method: 'POST', url: '/api/whatsapp/webhook', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature } }),
            )
          })
          cy.task<{ confirmation_status: string | null }[]>('db:selectRows', { table: 'appointments', columns: 'confirmation_status', match: { id: appt.id } })
            .its('0.confirmation_status')
            .should('eq', 'confirmed')
        }),
      ),
    )
  })

  it('confirms a booking to the tutor as well', () => {
    cy.task('db:setAutomaticMessages', { accountId: account.accountId, confirmation: true, reminder: false })
    person(account, 'Marta').then((tutor) =>
      minor(account, tutor.id).then((child) =>
        booking(account, child.id, true).then((appt) => {
          cy.task<{ slug: string }[]>('db:selectRows', { table: 'accounts', columns: 'slug', match: { id: account.accountId } }).then((rows) =>
            cy.request({ method: 'POST', url: '/api/public-booking/send-confirmation', body: { accountSlug: rows[0]!.slug, appointmentId: appt.id } }),
          )
          sendsTo(tutor.phone).should('have.length', 1)
          sendsTo(child.phone).should('have.length', 0)
        }),
      ),
    )
  })

  it('reminds nobody for a minor without a tutor', () => {
    minor(account, null).then((child) =>
      booking(account, child.id).then((appt) => {
        runCron()
        state(appt.id).its('reminder_sent_at').should('eq', null)
        sendsTo(child.phone).should('have.length', 0)
      }),
    )
  })

  it('reminds nobody when the tutor is marked do-not-contact', () => {
    person(account, 'Marta').then((tutor) => {
      cy.task('db:setPatientContactFlags', { patientId: tutor.id, doNotContact: true })
      minor(account, tutor.id).then((child) =>
        booking(account, child.id).then((appt) => {
          runCron()
          state(appt.id).its('reminder_sent_at').should('eq', null)
          sendsTo(tutor.phone).should('have.length', 0)
          sendsTo(child.phone).should('have.length', 0)
        }),
      )
    })
  })
})

describe("A minor's automations go to their tutor, unless they are marketing", () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as Account
      cy.login(account.email, account.password)
    })
  })

  const rule = (opts: Record<string, unknown>) =>
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Tutor',
      dryRun: true,
      actions: [
        { type: 'whatsapp_template', config: { template_name: 'cita_reservada', template_language: 'es' } },
        { type: 'email', config: { subject: 'Tu cita', body: '<p>Hola {{first_name}}</p>' } },
      ],
      ...opts,
    })
  const fire = (patientId: string) => cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId } })

  it('sends a transactional rule to the tutor, and a marketing one to nobody', () => {
    const tutorEmail = `tutor.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`
    rule({ triggerEvent: 'appointment.completed' })
    person(account, 'Marta', { email: tutorEmail }).then((tutor) =>
      minor(account, tutor.id).then((child) => {
        fire(child.id).its('body.fired').should('eq', 1)
        cy.task<{ phone_number: string; status: string }[]>('auto:whatsappFor', { patientId: tutor.id }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.phone_number).to.eq(tutor.phone.replace(/\D/g, ''))
          expect(rows[0]!.status).to.eq('would_send')
        })
        cy.task<{ recipient_email: string }[]>('auto:emailsFor', { patientId: tutor.id }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.recipient_email).to.eq(tutorEmail)
        })
        cy.task('auto:whatsappFor', { patientId: child.id }).should('have.length', 0)
      }),
    )
  })

  it('never sends a marketing rule about a minor, to them or their tutor', () => {
    rule({ triggerEvent: 'appointment.completed', isMarketing: true })
    person(account, 'Marta', { email: `tutor.${Date.now()}@example.test` }).then((tutor) => {
      cy.task('db:updateRows', { table: 'patients', values: { marketing_channels: ['whatsapp', 'email'] }, match: { id: tutor.id } })
      minor(account, tutor.id).then((child) => {
        fire(child.id).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: tutor.id }).should('have.length', 0)
        cy.task('auto:emailsFor', { patientId: tutor.id }).should('have.length', 0)
      })
    })
  })

  it('sends nothing when the tutor is marked do-not-contact', () => {
    rule({ triggerEvent: 'appointment.completed' })
    person(account, 'Marta', { email: `tutor.${Date.now()}@example.test` }).then((tutor) => {
      cy.task('db:setPatientContactFlags', { patientId: tutor.id, doNotContact: true })
      minor(account, tutor.id).then((child) => {
        fire(child.id).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: tutor.id }).should('have.length', 0)
        cy.task('auto:emailsFor', { patientId: tutor.id }).should('have.length', 0)
      })
    })
  })
})
