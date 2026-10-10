// Where a WhatsApp message goes, and whose thread it lands on.
//
// Sends here go to the local Graph stub (db:startMetaGraphStub), which only
// became possible once whatsappSend.ts read the Graph base URL from runtime
// config like the rest of the Meta calls -- before, every Inbox send went to
// graph.facebook.com and none of this could be exercised.
//
// - A reply went to the patient's "first" number (unordered), not the one
//   they wrote from, and the 24h check looked at that other number.
// - A status Meta reported before the outbound row was stored was dropped,
//   and the row then said 'sent' -- a fast failure showed as on its way.
// - A number several patients share was filed under whichever came back
//   first, minors included.
// - "Number without a patient": creating one stored Meta's international
//   digits as a local Spanish number, and linking one never stored the number
//   at all, so the next message from it was a stranger again.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const APP_SECRET_LENGTH = 32
let phoneNumberId = ''
let appSecret = ''

const localNumber = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

function connect(account: Account) {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
  cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
  cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'wa-test-token' })
}

function signedPost(payload: unknown) {
  const body = JSON.stringify(payload)
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
    cy.request({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
    }),
  )
}

function statusArrives(wamid: string, status: string, errors?: unknown[]) {
  return signedPost({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: wamid, status, ...(errors ? { errors } : {}) }] } }] }],
  })
}

function messageArrives(from: string, text: string) {
  return signedPost({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.in.${Date.now()}.${Math.random()}`, from, type: 'text', text: { body: text } }] } }] }],
  })
}

function messageByWamid(wamid: string) {
  return cy
    .task<{ status: string; error_code: string | null; phone_number: string | null }[]>('db:selectRows', {
      table: 'whatsapp_messages',
      columns: 'status, error_code, phone_number',
      match: { wamid },
    })
    .then((rows) => rows[0])
}

function inboxSend(body: Record<string, unknown>) {
  return cy.request({ method: 'POST', url: '/api/whatsapp/inbox-send', body, failOnStatusCode: false })
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

describe('WhatsApp sends from the Inbox', () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as Account
      connect(account)
    })
  })

  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it('replies to the number the patient wrote from, not their first one', () => {
    const first = localNumber()
    const second = localNumber()
    cy.task('db:startMetaGraphStub', {})
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dos', lastName: 'Móviles', phone: first }).then((patient) => {
      cy.task('db:addPatientContactNumber', { accountId: account.accountId, patientId: patient.id, number: second })
      // They wrote from the second number, ten minutes ago -- the only open
      // window there is.
      cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: patient.id, phoneNumber: `34${second}`, direction: 'inbound', createdAt: minutesAgo(10) })

      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      inboxSend({ patientId: patient.id, text: 'Te esperamos el jueves' }).then((res) => {
        expect(res.status, JSON.stringify(res.body)).to.eq(200)
      })
      cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
        expect(sends.map((s) => s?.to)).to.deep.equal([`34${second}`])
      })
    })
  })

  it('keeps a failure Meta reported before the message was stored', () => {
    const from = `34${localNumber()}`
    const wamidPrefix = `wamid.early.${Date.now()}.`
    cy.task('db:startMetaGraphStub', { wamidPrefix })
    cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: from, direction: 'inbound', createdAt: minutesAgo(5) })

    // The callback for the send below, delivered before its row exists --
    // what a fast refusal looks like while a media upload is still running.
    statusArrives(`${wamidPrefix}1`, 'failed', [{ code: 131047, title: 'Re-engagement message' }])

    cy.login(account.email, account.password)
    cy.visit('/dashboard')
    inboxSend({ phoneNumber: from, text: '¿Sigue interesado?' }).its('status').should('eq', 200)
    messageByWamid(`${wamidPrefix}1`).should((m) => {
      expect(m?.status).to.eq('failed')
      expect(m?.error_code).to.eq('131047')
    })
  })

  it('sends a template to a lead and files it in their thread', () => {
    // Past the 24h window a template is the only way to reach a lead, and the
    // send route took a patient or a bare number only: a row with no lead_id
    // never appears in the lead's own thread, which reads by lead_id.
    const phone = `34${localNumber()}`
    cy.task('db:startMetaGraphStub', {})
    cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Template Lead', stage: 'contacted', phone }).then((lead) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.request({
        method: 'POST',
        url: '/api/whatsapp/send',
        failOnStatusCode: false,
        body: { leadId: lead.id, templateName: 'seguimiento', templateLanguage: 'es', variables: [] },
      }).then((res) => {
        expect(res.status, JSON.stringify(res.body)).to.eq(200)
      })
      cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
        expect(sends.map((s) => [s?.to, s?.type])).to.deep.equal([[phone, 'template']])
      })
      cy.task<{ lead_id: string | null; template_name: string | null }[]>('db:selectRows', {
        table: 'whatsapp_messages',
        columns: 'lead_id, template_name',
        match: { lead_id: lead.id },
      }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.template_name).to.eq('seguimiento')
      })
    })
  })

  it('holds early statuses forward-only, whichever sender stores the row', () => {
    const wamid = `wamid.held.${Date.now()}`
    statusArrives(wamid, 'read')
    statusArrives(wamid, 'delivered')
    cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: `34${localNumber()}`, direction: 'outbound', status: 'sent', wamid })
    messageByWamid(wamid).its('status').should('eq', 'read')
  })
})

describe('An inbound WhatsApp from a number several patients share', () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as Account
      connect(account)
    })
  })

  it('goes to the adult, never silently to a child on the same phone', () => {
    const shared = localNumber()
    // The child's record is the older one, so "first match" was the child.
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nico', lastName: 'Menor', phone: shared }).then((child) => {
      cy.task('db:setPatientContactFlags', { patientId: child.id, isMinor: true })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Madre', phone: shared }).then((parent) => {
        messageArrives(`34${shared}`, 'Hola, ¿podemos cambiar la cita de Nico?')
        cy.task('db:messagesFromNumber', { accountId: account.accountId, phoneNumber: `34${shared}` }).should((rows: any) => {
          expect(rows).to.have.length(1)
          expect(rows[0].patient_id).to.eq(parent.id)
        })
      })
    })
  })

  it('goes to the patient whose conversation on that number is the live one', () => {
    const shared = localNumber()
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Luis', lastName: 'Mayor', phone: shared }).then((older) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Eva', lastName: 'Pareja', phone: shared }).then((partner) => {
        // The clinic wrote to the partner an hour ago; the older record's
        // last exchange was weeks back.
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: older.id, phoneNumber: `34${shared}`, direction: 'outbound', createdAt: minutesAgo(60 * 24 * 30) })
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: partner.id, phoneNumber: `34${shared}`, direction: 'outbound', createdAt: minutesAgo(60) })
        messageArrives(`34${shared}`, 'Perfecto, allí estaré')
        cy.task<{ id: string }[]>('db:inboundMessages', { patientId: partner.id }).should('have.length', 1)
        cy.task<{ id: string }[]>('db:inboundMessages', { patientId: older.id }).should('have.length', 0)
      })
    })
  })
})

describe('A number without a patient, in the Inbox', () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as Account
    })
  })

  it('creates the patient with the number they wrote from, not a doubled dial code', () => {
    const local = localNumber()
    cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: `34${local}`, direction: 'inbound', bodyPreview: 'Hola, soy nueva' })
    cy.login(account.email, account.password)
    cy.visit('/inbox')
    cy.contains('[data-cy=inbox-row]', `34${local}`).click()
    cy.get('[data-cy=unknown-create]').click()
    cy.get('[data-cy=unknown-first-name]').type('Nueva')
    cy.get('[data-cy=unknown-last-name]').type(`Paciente${local}`)
    cy.get('[data-cy=unknown-create-submit]').click()
    cy.contains(/Linked\.|Vinculado\./).should('exist')
    cy.task<{ id: string }[]>('db:selectRows', { table: 'patients', columns: 'id', match: { account_id: account.accountId, last_name: `Paciente${local}` } }).then((rows) => {
      cy.task('db:patientContactNumbers', { patientId: rows[0]!.id }).should('deep.equal', [{ number: local, country_code: 'ES', is_whatsapp: true }])
    })
  })

  it('stores the number on the patient it is linked to, so the next message finds them', () => {
    const local = localNumber()
    cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: `34${local}`, direction: 'inbound', bodyPreview: 'Soy Lucía, desde otro móvil' })
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: `Vinculada${local}`, phone: localNumber() }).then((patient) => {
      cy.login(account.email, account.password)
      cy.visit('/inbox')
      cy.contains('[data-cy=inbox-row]', `34${local}`).click()
      cy.get('[data-cy=unknown-search]').type(`Vinculada${local}`)
      cy.contains('[data-cy=unknown-result]', 'Lucía').click()
      cy.contains(/Linked\.|Vinculado\./).should('exist')
      cy.task<{ number: string; country_code: string }[]>('db:patientContactNumbers', { patientId: patient.id }).should((numbers) => {
        expect(numbers).to.have.length(2)
        expect(numbers[1]).to.include({ number: local, country_code: 'ES' })
      })
    })
  })
})
