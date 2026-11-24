// Editing a WhatsApp template that already exists at Meta, from the same
// dialog that creates one.
//
// Meta's edit replaces every component with the ones sent, so the two things
// worth proving are what goes up -- the whole template, the kept file again
// as its sample, no category for an approved one -- and what is refused
// rather than cut down: a template with a button QuiroFlow cannot make (a
// Flow, say) is left to WhatsApp Manager.
// A new file also has to reach the automations, which copy the template's
// file into each step when it is chosen. Meta is the local Graph stub
// (db:startMetaGraphStub). The staff UI runs in English here.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const pdf = (fileName: string) => ({ contents: Cypress.Buffer.from(`%PDF-1.4\n% ${fileName}\n%%EOF`), fileName, mimeType: 'application/pdf' })

const GUIDE_BODY = 'Hola {{1}}, aquí tienes la guía de ejercicios que comentamos en consulta.'

function connect(account: Account) {
  cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '232335383285622' })
  cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
}

function openApprovedList() {
  cy.get('[data-cy="whatsapp-templates-all"]').then(($details) => {
    if (!$details.prop('open')) cy.wrap($details).find('summary').click()
  })
}

function editApproved(name: string) {
  openApprovedList()
  cy.get(`[data-template-row="${name}"] [data-cy="whatsapp-template-edit"]`).click()
}

describe('Editing a WhatsApp template', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('sends an approved guide back with its kept PDF, and moves automations onto a new one', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      // Made in QuiroFlow, so its PDF is kept.
      const guide = pdf('Guía lumbar.pdf')
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()
      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-title"]').type('Guía lumbar')
        cy.get('[data-cy="template-header-document"]').click()
        cy.get('[data-cy="template-file"]').selectFile(guide)
        cy.get('[data-cy="template-body"]').type('Hola ')
        cy.get('[data-cy="template-add-variable"]').click()
        cy.get('[data-cy="template-body"]').type(', aquí tienes la guía de ejercicios que comentamos en consulta.')
        cy.get('[data-cy="template-footer"]').type('Clínica Demo')
        cy.get('[data-cy="template-submit"]').click()
      })
      cy.get('[data-cy="whatsapp-template-created"]').should('contain', 'guia_lumbar')

      // Meta approves it, and an automation sends it with the file the builder copied in.
      const approved = { name: 'guia_lumbar', language: 'es', status: 'APPROVED', header: 'DOCUMENT' as const, body: GUIDE_BODY, examples: ['Ana'], footer: 'Clínica Demo' }
      cy.task('db:startMetaGraphStub', { templates: [approved] })
      cy.request('/api/whatsapp/templates').then((res) => {
        cy.task('db:createAutomationRule', {
          accountId: account.accountId,
          triggerEvent: 'appointment.booked',
          name: 'Guía lumbar',
          actions: [{ type: 'whatsapp_template', config: { template_name: 'guia_lumbar', template_language: 'es', variables: [{ source: 'first_name' }], header: res.body.templates[0].headerMedia } }],
        })
      })
      cy.get('[data-cy="whatsapp-templates-refresh"]').click()

      editApproved('guia_lumbar')
      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.contains('h2', 'Edit WhatsApp template')
        cy.get('[data-cy="template-name"]').should('have.text', 'guia_lumbar')
        cy.get('[data-cy="template-title"]').should('not.exist')
        // Meta keeps an approved template's category.
        cy.get('[data-cy="template-category-locked"]').should('exist')
        cy.get('[data-cy="template-category-marketing"]').should('be.disabled')
        // What Meta has now, ready to change.
        cy.get('[data-cy="template-body"]').should('have.value', GUIDE_BODY)
        cy.get('[data-cy="template-footer"]').should('have.value', 'Clínica Demo')
        cy.get('[data-cy="template-kept-file"]').should('contain', 'Guia-lumbar.pdf')

        cy.get('[data-cy="template-body"]').clear().type('Hola ')
        cy.get('[data-cy="template-add-variable"]').click()
        cy.get('[data-cy="template-body"]').type(', esta es la guía nueva de ejercicios para casa.')
        cy.get('[data-cy="template-submit"]').should('contain', 'Send the change to Meta').click()
      })
      cy.get('[data-cy="template-dialog"]').should('not.exist')
      cy.get('[data-cy="whatsapp-template-edited"]').should('contain', 'guia_lumbar')

      cy.task<{ edits: any[]; uploads: { bytes: number }[] }>('db:metaGraphStubTemplateCreates').then(({ edits, uploads }) => {
        // The kept PDF went up again: Meta replaces the header with whatever is sent.
        expect(uploads, 'the kept file is the sample').to.have.length(1)
        expect(uploads[0]!.bytes).to.eq(guide.contents.length)
        expect(edits).to.have.length(1)
        expect(edits[0]._id).to.eq('tpl-guia_lumbar-es')
        expect(edits[0], 'an approved template is sent without its category').not.to.have.property('category')
        expect(edits[0].components).to.deep.eq([
          { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['STUB-HANDLE-1'] } },
          { type: 'BODY', text: 'Hola {{1}}, esta es la guía nueva de ejercicios para casa.', example: { body_text: [['Ana']] } },
          { type: 'FOOTER', text: 'Clínica Demo' },
        ])
      })
      // The automation still sends the same file: nothing new was attached.
      cy.task<any[]>('db:latestAutomationActions', { accountId: account.accountId }).then(([step]) => {
        expect(step.config.header.filename).to.eq('Guia-lumbar.pdf')
      })

      // A new PDF this time: the automation has to follow it.
      cy.task('db:startMetaGraphStub', { templates: [approved] })
      cy.get('[data-cy="whatsapp-templates-refresh"]').click()
      editApproved('guia_lumbar')
      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-file"]').selectFile(pdf('Guía lumbar v2.pdf'))
        cy.get('[data-cy="template-preview"]').should('contain', 'Guía lumbar v2.pdf')
        cy.get('[data-cy="template-submit"]').click()
      })
      cy.get('[data-cy="template-dialog"]').should('not.exist')

      cy.task<any[]>('db:latestAutomationActions', { accountId: account.accountId }).then(([step]) => {
        expect(step.config.template_name).to.eq('guia_lumbar')
        expect(step.config.header).to.deep.include({ type: 'document', filename: 'Guia-lumbar-v2.pdf' })
        expect(step.config.header.storage_path).to.match(new RegExp(`^${account.accountId}/templates/guia_lumbar\\.es\\.\\d+\\.Guia-lumbar-v2\\.pdf$`))
      })
      cy.request('/api/whatsapp/templates').then((res) => {
        expect(res.body.templates[0].headerMedia.filename, 'sends from now on bring the new file').to.eq('Guia-lumbar-v2.pdf')
      })
    })
  })

  it('fixes a rejected template from WhatsApp Manager, and leaves one with a Flow button alone', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {
        templates: [
          { name: 'oferta_bono', language: 'es', status: 'REJECTED', rejectedReason: 'TAG_CONTENT_MISMATCH', header: 'DOCUMENT', body: 'Hola {{1}}, este mes tienes un 20% en bonos.', examples: ['Ana'] },
          { name: 'bienvenida', language: 'es', status: 'APPROVED', body: 'Hola {{1}}, reserva tu primera visita aquí.', examples: ['Ana'], buttons: [{ type: 'FLOW', text: 'Reservar' }] },
        ],
      })
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      // A Flow would not survive an edit from here, so it is not offered.
      openApprovedList()
      cy.get('[data-template-row="bienvenida"]').within(() => {
        cy.get('[data-cy="whatsapp-template-edit-blocked"]').should('contain', 'flow button').and('contain', 'WhatsApp Manager')
        cy.get('[data-cy="whatsapp-template-edit"]').should('not.exist')
      })

      cy.get('[data-cy="whatsapp-templates-in-review"] [data-template-row="oferta_bono"]').should('contain', 'Rejected').find('[data-cy="whatsapp-template-edit"]').click()
      cy.get('[data-cy="template-dialog"]').within(() => {
        // Rejected for its category, which a rejected template may change.
        cy.get('[data-cy="template-category-locked"]').should('not.exist')
        cy.get('[data-cy="template-category-marketing"]').click()
        // Made in WhatsApp Manager: no PDF kept here, so Meta needs one.
        cy.get('[data-cy="template-submit"]').click()
        cy.get('[data-cy="template-problems"]').should('contain', 'Attach the PDF')
        cy.get('[data-cy="template-header-none"]').click()
        cy.get('[data-cy="template-submit"]').click()
      })
      cy.get('[data-cy="template-dialog"]').should('not.exist')

      cy.task<{ edits: any[]; uploads: unknown[] }>('db:metaGraphStubTemplateCreates').then(({ edits, uploads }) => {
        expect(uploads).to.have.length(0)
        expect(edits).to.have.length(1)
        expect(edits[0]).to.deep.include({ _id: 'tpl-oferta_bono-es', category: 'MARKETING' })
        expect(edits[0].components).to.deep.eq([{ type: 'BODY', text: 'Hola {{1}}, este mes tienes un 20% en bonos.', example: { body_text: [['Ana']] } }])
      })
    })
  })

  it("says in plain words why Meta refuses the change, and what stops sending meanwhile; edits nothing outside the account", () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {
        templates: [
          { name: 'recordatorio', language: 'es', status: 'APPROVED', body: 'Hola {{1}}, te esperamos mañana en consulta.', examples: ['Ana'] },
          { name: 'oferta_pendiente', language: 'es', status: 'PENDING', body: 'Hola {{1}}, tienes un 10% en tu próximo bono.', examples: ['Ana'] },
        ],
        refuseTemplate: 'You can only edit an approved template once every 24 hours.',
      })
      connect(account)
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')

      // One Meta is still reviewing says why it has no Edit, rather than only Delete.
      cy.get('[data-cy="whatsapp-templates-in-review"] [data-template-row="oferta_pendiente"]').within(() => {
        cy.get('[data-cy="whatsapp-template-edit-blocked"]').should('contain', 'still reviewing')
        cy.get('[data-cy="whatsapp-template-edit"]').should('not.exist')
        cy.get('[data-cy="whatsapp-template-delete"]').should('exist')
      })

      // Chosen for the reminder: Edit sits beside it, and the dialog names the
      // reminder as something that may stop while Meta reviews the change.
      cy.get('[data-template-use="reminder"] [data-cy="whatsapp-template-select"] option').contains('recordatorio').then((option) => {
        cy.get('[data-template-use="reminder"] [data-cy="whatsapp-template-select"]').select(String(option.val()))
      })
      cy.get('[data-cy="whatsapp-save"]').click()
      cy.wait('@saveAccount')
      cy.get('[data-template-use="reminder"] [data-cy="whatsapp-use-edit"]').click()
      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-edit-uses"]').should('contain', 'Appointment reminder')
        cy.get('[data-cy="template-submit"]').click()
        // Meta's own English is not what the front desk reads.
        cy.get('[data-cy="template-error"]').should('contain', 'once a day and up to 10 times a month').and('not.contain', 'once every 24 hours')
      })
      cy.get('[data-cy="template-dialog"]').should('exist')

      // An id Meta does not list for this account is not edited, whatever it is.
      const form = new FormData()
      form.append('draft', JSON.stringify({ name: 'otra', language: 'es', category: 'UTILITY', header: 'none', body: 'Hola {{1}}, tu cita es mañana.', examples: ['Ana'], footer: '' }))
      cy.window().then((win) =>
        win.fetch('/api/whatsapp/templates/tpl-otra-clinica-es', { method: 'POST', body: form }).then((res) => {
          expect(res.status).to.eq(404)
        }),
      )
      cy.task<{ edits: unknown[] }>('db:metaGraphStubTemplateCreates').its('edits').should('have.length', 0)
    })
  })
})
