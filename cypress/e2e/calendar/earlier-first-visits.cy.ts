import type { StaffAccount } from '../../support/commands'

// Offering an earlier time to someone whose first visit is days away
// (earlier_visit_offers; server/utils/earlierVisitOffers.ts): the database
// enrols the visit, the waitlist sweep offers the earliest free time by
// WhatsApp in the patient's language, and a tap on the template's buttons
// moves the visit or leaves it -- against the Meta Graph stub.

const TEMPLATE = 'adelantar_primera_visita'
const ALL_DAY = [['00:00', '23:59']]
const EVERY_DAY = { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY }
const APP_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000)
const cron = () => cy.request({ method: 'POST', url: '/api/waitlist/expire-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
// The sweep acts for every account in the database, so only this patient's sends.
type Sent = { to?: string; type?: string; template?: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] }; text?: { body: string } }
const sendsTo = (phone: string) =>
  cy.task<Sent[]>('db:metaGraphStubSends').then((all) => all.filter((m) => m?.to === phone.replace(/\D/g, ''))) as unknown as Cypress.Chainable<Sent[]>

type Offer = { id: string; status: string; offers_made: number; offered_starts_at: string | null; closed_reason: string | null }
const offers = (appointmentId: string) =>
  cy.task<Offer[]>('db:selectRows', { table: 'earlier_visit_offers', columns: 'id, status, offers_made, offered_starts_at, closed_reason', match: { appointment_id: appointmentId } })
const offerFor = (appointmentId: string) => offers(appointmentId).its('0')
const startsAtOf = (appointmentId: string) =>
  cy.task<{ starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'starts_at', match: { id: appointmentId } }).then((rows) => rows[0]!.starts_at)

interface Seeded {
  account: StaffAccount
  phoneNumberId: string
  patientId: string
  phone: string
  firstVisitTypeId: string
  adjustmentTypeId: string
}

/** A clinic open all week with the receptionist's diary readable, WhatsApp connected, and a patient with a mobile. */
function seed(opts: { enabled?: boolean; language?: string } = {}): Cypress.Chainable<Seeded> {
  const phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const phone = `+346${Math.floor(10000000 + Math.random() * 89999999)}`
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:updateRows', {
      table: 'accounts',
      values: { earlier_first_visit_offers: opts.enabled ?? true, whatsapp_business_account_id: 'waba-stub', whatsapp_phone_number_id: phoneNumberId, whatsapp_access_token: 'stub-token' },
      match: { id: account.accountId },
    })
    cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret: APP_SECRET })
    cy.task('db:updateRows', { table: 'clinics', values: { business_hours: EVERY_DAY }, match: { id: account.clinicId } })
    cy.task('db:updateRows', { table: 'team_members', values: { is_practitioner: true, online_booking_enabled: true, business_hours: EVERY_DAY }, match: { id: account.teamMemberId } })
    cy.task<unknown[]>('db:selectRows', { table: 'team_member_clinics', columns: 'team_member_id', match: { team_member_id: account.teamMemberId, clinic_id: account.clinicId } }).then((links) => {
      if (links.length === 0) cy.task('db:insertRows', { table: 'team_member_clinics', rows: [{ team_member_id: account.teamMemberId, clinic_id: account.clinicId }] })
    })
    return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita oferta', durationMinutes: 45, stage: 'first_visit_offer' }).then((firstVisit) =>
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 20, stage: 'adjustment' }).then((adjustment) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Prueba', phone }).then((patient) => {
          if (opts.language) cy.task('db:updateRows', { table: 'patients', values: { preferred_language: opts.language }, match: { id: patient.id } })
          return cy.wrap({ account, phoneNumberId, patientId: patient.id, phone, firstVisitTypeId: firstVisit.id, adjustmentTypeId: adjustment.id })
        }),
      ),
    )
  })
}

function book(s: Seeded, typeId: string, inDays: number) {
  return cy.task<{ id: string }>('db:createAppointment', {
    accountId: s.account.accountId,
    clinicId: s.account.clinicId,
    patientId: s.patientId,
    practitionerId: s.account.teamMemberId,
    appointmentTypeId: typeId,
    startsAt: daysFromNow(inDays).toISOString(),
    durationMinutes: typeId === s.firstVisitTypeId ? 45 : 20,
  })
}

/** A tap on one of the template's buttons, as Meta delivers it: the title, quoting the template. */
function tap(s: Seeded, title: string, quotedWamid: string) {
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: s.phoneNumberId },
              messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from: s.phone.replace(/\D/g, ''), type: 'button', button: { text: title }, context: { id: quotedWamid } }],
            },
          },
        ],
      },
    ],
  })
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret: APP_SECRET }).then((signed) =>
    cy.request({ method: 'POST', url: '/api/whatsapp/webhook', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature } }),
  )
}

const templateWamid = (appointmentId: string) =>
  cy.task<{ wamid: string }[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'wamid', match: { appointment_id: appointmentId, template_name: TEMPLATE } }).then((rows) => {
    expect(rows, 'the offer was logged').to.have.length(1)
    return rows[0]!.wamid
  })

function templates() {
  return cy.task('db:startMetaGraphStub', {
    templates: ['es', 'fr', 'en'].map((language) => ({ name: TEMPLATE, language, status: 'APPROVED', body: 'Hola {{1}}, se ha liberado un hueco el {{2}}. Tu primera visita es el {{3}}.' })),
  })
}

describe('Earlier first visits', () => {
  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it('enrols only first visits two or more days away, at a clinic that has it on', () => {
    seed().then((s) => {
      book(s, s.firstVisitTypeId, 5).then((far) => offerFor(far.id).its('status').should('eq', 'waiting'))
      book(s, s.firstVisitTypeId, 1).then((near) => offers(near.id).should('have.length', 0))
      book(s, s.adjustmentTypeId, 5).then((adjustment) => offers(adjustment.id).should('have.length', 0))
    })
    seed({ enabled: false }).then((s) => {
      book(s, s.firstVisitTypeId, 5).then((far) => offers(far.id).should('have.length', 0))
    })
  })

  it('offers the earliest free time in their language, and "Oui, avancer" moves the visit', () => {
    templates()
    seed({ language: 'fr' }).then((s) => {
      book(s, s.firstVisitTypeId, 5).then((appt) => {
        cron().its('status').should('eq', 200)
        offerFor(appt.id).then((offer: Offer) => {
          expect(offer.status).to.eq('offered')
          expect(offer.offers_made).to.eq(1)
          // At least three hours from now, at least twelve before their visit.
          const offered = Date.parse(offer.offered_starts_at!)
          expect(offered).to.be.gte(Date.now() + 3 * 3_600_000 - 60_000)
          expect(offered).to.be.lte(daysFromNow(5).getTime() - 12 * 3_600_000)

          sendsTo(s.phone).then((sends) => {
            const sent = sends.find((m) => m.template?.name === TEMPLATE)
            expect(sent, 'template sent').to.exist
            expect(sent!.template!.language.code).to.eq('fr')
            const params = sent!.template!.components.find((c) => c.type === 'body')!.parameters.map((p) => p.text)
            expect(params[0]).to.eq('Ana')
            // French days and months: "jeudi 12 novembre à 17:00".
            expect(params[1]).to.match(/ à \d{2}:\d{2}$/)
            expect(params[2]).to.match(/ à \d{2}:\d{2}$/)
          })

          templateWamid(appt.id).then((wamid) => {
            tap(s, 'Oui, avancer', wamid).its('status').should('eq', 200)
            offerFor(appt.id).its('status').should('eq', 'accepted')
            startsAtOf(appt.id).then((startsAt) => expect(Date.parse(startsAt)).to.eq(offered))
            sendsTo(s.phone).then((sends) => {
              const reply = sends.find((m) => m.type === 'text')
              expect(reply?.text?.body, 'confirmation in French').to.match(/^C'est fait/)
            })
            // A second tap moves nothing again.
            tap(s, 'Oui, avancer', wamid).its('status').should('eq', 200)
            startsAtOf(appt.id).then((startsAt) => expect(Date.parse(startsAt)).to.eq(offered))
          })
        })
      })
    })
  })

  it('"No, me quedo con la mía" keeps the visit and offers nothing more', () => {
    templates()
    seed().then((s) => {
      book(s, s.firstVisitTypeId, 5).then((appt) => {
        startsAtOf(appt.id).then((before) => {
          cron()
          offerFor(appt.id).its('status').should('eq', 'offered')
          templateWamid(appt.id).then((wamid) => {
            tap(s, 'No, me quedo con la mía', wamid).its('status').should('eq', 200)
            offerFor(appt.id).then((offer: Offer) => {
              expect(offer.status).to.eq('declined')
              expect(offer.closed_reason).to.eq('patient_said_no')
            })
            startsAtOf(appt.id).should('eq', before)
            // Not read as an answer to a reminder either.
            cy.task<{ confirmation_status: string | null }[]>('db:selectRows', { table: 'appointments', columns: 'confirmation_status', match: { id: appt.id } }).its('0.confirmation_status').should('eq', null)
            sendsTo(s.phone).then((sends) => expect(sends.find((m) => m.type === 'text')?.text?.body).to.match(/^Perfecto, mantienes tu primera visita/))
          })
        })
      })
    })
  })

  it('offers once a day: a second sweep sends nothing new', () => {
    templates()
    seed().then((s) => {
      book(s, s.firstVisitTypeId, 5).then((appt) => {
        cron()
        offerFor(appt.id).its('status').should('eq', 'offered')
        // Unanswered past its deadline: back to waiting, and not offered again today.
        cy.task('db:updateRows', { table: 'earlier_visit_offers', values: { offer_expires_at: new Date(Date.now() - 60_000).toISOString() }, match: { appointment_id: appt.id } })
        cron()
        offerFor(appt.id).then((offer: Offer) => {
          expect(offer.status).to.eq('waiting')
          expect(offer.offers_made).to.eq(1)
        })
        sendsTo(s.phone).then((sends) => expect(sends.filter((m) => m.template?.name === TEMPLATE)).to.have.length(1))
      })
    })
  })

  it('lists them on the Waitlist page, where the desk can take someone off', () => {
    seed().then((s) => {
      book(s, s.firstVisitTypeId, 5).then((appt) => {
        cy.login(s.account.email, s.account.password)
        cy.visit('/waitlist')
        cy.get('[data-cy=earlier-first-visits]').should('be.visible')
        cy.get('[data-cy=earlier-first-visit-row]').should('have.length', 1).and('contain', 'Ana Prueba').find('button').click()
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=earlier-first-visits-empty]').should('be.visible')
        offerFor(appt.id).its('status').should('eq', 'declined')
      })
    })
  })
})
