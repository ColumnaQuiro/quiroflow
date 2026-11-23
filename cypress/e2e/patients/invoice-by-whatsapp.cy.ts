// "Send by WhatsApp" beside "Send by email" on a receipt.
//
// WhatsApp only lets a business start a conversation with an approved
// template, so the receipt goes as the document header of the one the clinic
// chose in Settings > WhatsApp. Until it has chosen one the button is there
// but disabled, and says where to go.
//
// Sends go to the local Graph stub (db:startMetaGraphStub): nothing here
// reaches Meta or a real phone.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const TEMPLATE = 'envio_factura_pdf'
const localNumber = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

const templates = [
  { name: TEMPLATE, language: 'es', status: 'APPROVED', header: 'DOCUMENT' as const, body: 'Hola {{1}}, te enviamos {{2}} por un importe de {{3}}. Gracias por tu visita a {{4}}.' },
  { name: 'recordatorio_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}, te recordamos tu cita el {{2}}.' },
]

function connect(account: Account) {
  cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: `waba-${Date.now()}` })
  cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'wa-test-token' })
}

function chooseTemplate(account: Account, name: string | null = TEMPLATE) {
  cy.task('db:updateRows', { table: 'accounts', values: { whatsapp_invoice_template_name: name, whatsapp_invoice_template_language: 'es' }, match: { id: account.accountId } })
}

function receiptFor(account: Account, patient: { firstName: string; lastName: string; phone?: string }) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, ...patient }).then((created) =>
    cy.task<{ id: string; invoice_number: string }>('db:createInvoice', { accountId: account.accountId, patientId: created.id, totalCents: 4500 }).then((invoice) => {
      cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Ajuste quiropráctico', priceCents: 4500 })
      return cy.wrap({ patientId: created.id, invoiceId: invoice.id, number: invoice.invoice_number })
    }),
  )
}

const button = () => cy.get('[data-cy="invoice-send-whatsapp"]')
const tooltip = () => cy.get('[data-cy="invoice-whatsapp-wrap"]')

describe('A receipt by WhatsApp', () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as Account
    })
  })

  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it('is disabled until WhatsApp is connected and a template chosen, then sends the PDF with it', () => {
    receiptFor(account, { firstName: 'Marta', lastName: 'Prueba', phone: localNumber() }).then(({ patientId, invoiceId, number }) => {
      cy.login(account.email, account.password)

      // Nothing connected: there, disabled, and it says so.
      cy.visit(`/billing/${invoiceId}`)
      button().should('be.disabled')
      tooltip().should('have.attr', 'title').and('contain', 'WhatsApp is not connected')

      // Connected, no template chosen for receipts: still disabled, and it
      // points at the setting.
      cy.task('db:startMetaGraphStub', { templates })
      connect(account)
      cy.reload()
      tooltip().should('have.attr', 'title').and('contain', 'Choose the template for receipts and invoices')
      button().should('be.disabled')
      cy.get('[data-cy="invoice-whatsapp-reason"]').contains('a', 'Open WhatsApp settings').click()

      // Chosen where every other template is, and saved with the page.
      cy.location('pathname').should('eq', '/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.get('[data-template-use="invoice"] [data-cy="whatsapp-template-select"] option').contains(TEMPLATE).then((option) => {
        cy.get('[data-template-use="invoice"] [data-cy="whatsapp-template-select"]').select(String(option.val()))
      })
      cy.get('[data-cy="whatsapp-invoice-template-no-document"]').should('not.exist')
      cy.get('[data-cy="whatsapp-save"]').click()
      cy.wait('@saveAccount').its('request.body.whatsapp_invoice_template_name').should('eq', TEMPLATE)

      // Now it can be pressed.
      cy.visit(`/billing/${invoiceId}`)
      button().should('not.be.disabled')
      tooltip().should('not.have.attr', 'title')
      cy.intercept('POST', `/api/invoices/${invoiceId}/send-whatsapp`).as('send')
      button().click()
      cy.wait('@send').its('response.statusCode').should('eq', 200)
      cy.get('[data-cy="invoice-whatsapp-result"]').should('contain', 'Sent by WhatsApp')

      // What Meta was asked to send: the template, with the PDF named by the
      // id its upload got and the body's four blanks filled.
      cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
        expect(sends).to.have.length(1)
        const sent = sends[0]
        expect(sent.type).to.eq('template')
        expect(sent.template.name).to.eq(TEMPLATE)
        expect(sent.template.language.code).to.eq('es')
        expect(sent.to).to.match(/^\+?34\d{9}$/)
        const header = sent.template.components.find((c: any) => c.type === 'header')
        expect(header.parameters[0].type).to.eq('document')
        expect(header.parameters[0].document.id).to.match(/^media\.STUB\./)
        expect(header.parameters[0].document.filename).to.eq(`${number}.pdf`)
        const body = sent.template.components.find((c: any) => c.type === 'body')
        const values = body.parameters.map((p: any) => p.text)
        expect(values).to.have.length(4)
        expect(values[0]).to.eq('Marta')
        expect(values[1]).to.eq(`Recibo ${number}`)
        expect(values[2]).to.contain('45,00')
        expect(values[3]).to.be.a('string').and.not.be.empty
      })

      // Recorded where a template send is: the patient's thread, with the
      // document on it, and the contact log.
      cy.task<any[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'template_name, direction, status, media_type, media_filename, body_preview, wamid', match: { patient_id: patientId } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0].template_name).to.eq(TEMPLATE)
        expect(rows[0].direction).to.eq('outbound')
        expect(rows[0].media_type).to.eq('document')
        expect(rows[0].media_filename).to.eq(`${number}.pdf`)
        expect(rows[0].body_preview).to.contain(`Hola Marta, te enviamos Recibo ${number}`)
        expect(rows[0].wamid).to.be.a('string')
      })
      cy.task<any[]>('db:selectRows', { table: 'contact_log', columns: 'action, note', match: { patient_id: patientId } }).then((rows) => {
        expect(rows.map((r) => r.action)).to.include('sent_whatsapp')
        expect(rows.find((r) => r.action === 'sent_whatsapp').note).to.contain(TEMPLATE)
      })
    })
  })

  it('is disabled, with its own reason, for a patient with no phone number', () => {
    cy.task('db:startMetaGraphStub', { templates })
    connect(account)
    chooseTemplate(account)
    receiptFor(account, { firstName: 'Lucas', lastName: 'Sinmovil' }).then(({ invoiceId }) => {
      cy.login(account.email, account.password)
      cy.visit(`/billing/${invoiceId}`)
      tooltip().should('have.attr', 'title').and('contain', 'no phone number')
      button().should('be.disabled')
      // Nothing to set up, so no link to the settings.
      cy.get('[data-cy="invoice-whatsapp-reason"]').should('contain', 'no phone number').find('a').should('not.exist')

      // And the server says the same to a request made without the button.
      cy.request({ method: 'POST', url: `/api/invoices/${invoiceId}/send-whatsapp`, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.statusMessage).to.contain('no phone number')
      })
      cy.task<any[]>('db:metaGraphStubSends').should('have.length', 0)
    })
  })

  it('shows what Meta said when it refuses the message, and records nothing as sent', () => {
    cy.task('db:startMetaGraphStub', { templates, failSends: true })
    connect(account)
    chooseTemplate(account)
    receiptFor(account, { firstName: 'Irene', lastName: 'Prueba', phone: localNumber() }).then(({ patientId, invoiceId }) => {
      cy.login(account.email, account.password)
      cy.visit(`/billing/${invoiceId}`)
      button().should('not.be.disabled').click()
      cy.get('[data-cy="invoice-whatsapp-result"]').should('contain', 'Template is paused.')
      cy.task<any[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'id', match: { patient_id: patientId } }).should('have.length', 0)
    })
  })

  it('refuses a template with no document header before asking Meta', () => {
    cy.task('db:startMetaGraphStub', { templates })
    connect(account)
    chooseTemplate(account, 'recordatorio_cita')
    receiptFor(account, { firstName: 'Nora', lastName: 'Prueba', phone: localNumber() }).then(({ invoiceId }) => {
      cy.login(account.email, account.password)
      cy.request({ method: 'POST', url: `/api/invoices/${invoiceId}/send-whatsapp`, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.statusMessage).to.contain('no document header')
      })
      cy.task<any[]>('db:metaGraphStubSends').should('have.length', 0)

      // The settings page says so where it is chosen.
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      cy.get('[data-cy="whatsapp-invoice-template-no-document"]').should('be.visible')
    })
  })

  it('does not send another clinic’s receipt', () => {
    cy.task('db:startMetaGraphStub', { templates })
    connect(account)
    chooseTemplate(account)
    cy.seedStaffAccount().then((seeded) => {
      const other = seeded as Account
      receiptFor(other, { firstName: 'Olga', lastName: 'Prueba', phone: localNumber() }).then(({ invoiceId }) => {
        cy.login(account.email, account.password)
        cy.request({ method: 'POST', url: `/api/invoices/${invoiceId}/send-whatsapp`, failOnStatusCode: false }).its('status').should('eq', 404)
        cy.task<any[]>('db:metaGraphStubSends').should('have.length', 0)
      })
    })
  })
})
