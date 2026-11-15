// Creating a WhatsApp template from QuiroFlow -- above all one with a PDF at
// the top, which is how a clinic sends a patient a guide.
//
// Before this a template could only be made in WhatsApp Manager, and one with
// a file header in particular was beyond almost every clinic, so the
// automation's ability to attach a file went unused. Meta is the local Graph
// stub (db:startMetaGraphStub): it records the submission and the sample file
// that went up through the Resumable Upload API before it. The staff UI runs
// in English here; the template itself is written in Spanish.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const pdf = (fileName: string) => ({ contents: Cypress.Buffer.from(`%PDF-1.4\n% ${fileName}\n%%EOF`), fileName, mimeType: 'application/pdf' })

function connect(account: Account) {
  cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '232335383285622' })
  cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
}

function writeGuide(title: string, file: ReturnType<typeof pdf>) {
  cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()
  cy.get('[data-cy="template-dialog"]').within(() => {
    cy.get('[data-cy="template-title"]').type(title)
    cy.get('[data-cy="template-file"]').selectFile(file)
    cy.get('[data-cy="template-body"]').type('Hola ')
    cy.get('[data-cy="template-add-variable"]').click()
    cy.get('[data-cy="template-body"]').type(', aquí tienes la guía de ejercicios que comentamos en consulta.')
    cy.get('[data-cy="template-footer"]').type('Clínica Demo')
    cy.get('[data-cy="template-preview"]').should('contain', 'Hola Ana, aquí tienes la guía').and('contain', file.fileName)
    cy.get('[data-cy="template-submit"]').click()
  })
}

describe('Creating a WhatsApp template with a PDF', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('submits it to Meta with the file, and the file goes out with every send', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      // Problems show on the first attempt, not while typing.
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()
      cy.get('[data-cy="template-submit"]').click()
      cy.get('[data-cy="template-problems"]').should('contain', 'Give the template a name').and('contain', 'Attach the PDF')
      cy.get('[data-cy="template-dialog"]').find('button[aria-label="Close"]').click()

      const guide = pdf('Guía lumbar.pdf')
      writeGuide('Guía lumbar', guide)
      cy.get('[data-cy="template-dialog"]').should('not.exist')
      cy.get('[data-cy="whatsapp-template-created"]').should('contain', 'guia_lumbar')

      cy.task<{ creates: any[]; uploads: { bytes: number; authorization: string }[] }>('db:metaGraphStubTemplateCreates').then(({ creates, uploads }) => {
        expect(uploads, 'the sample went up once').to.have.length(1)
        expect(uploads[0]!.bytes).to.eq(guide.contents.length)
        expect(uploads[0]!.authorization, 'the upload endpoint wants the OAuth scheme').to.eq('OAuth EAAT-stub-token')
        expect(creates).to.have.length(1)
        expect(creates[0]._path).to.eq('/232335383285622/message_templates')
        expect(creates[0]).to.deep.include({ name: 'guia_lumbar', language: 'es', category: 'UTILITY' })
        expect(creates[0].components).to.deep.eq([
          { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['STUB-HANDLE-1'] } },
          { type: 'BODY', text: 'Hola {{1}}, aquí tienes la guía de ejercicios que comentamos en consulta.', example: { body_text: [['Ana']] } },
          { type: 'FOOTER', text: 'Clínica Demo' },
        ])
      })

      // Meta approves it; another is rejected and says why.
      cy.task('db:startMetaGraphStub', {
        templates: [
          { name: 'guia_lumbar', language: 'es', status: 'APPROVED', header: 'DOCUMENT', body: 'Hola {{1}}, aquí tienes la guía de ejercicios que comentamos en consulta.' },
          { name: 'oferta_bono', language: 'es', status: 'REJECTED', rejectedReason: 'TAG_CONTENT_MISMATCH', body: 'Hola {{1}}, 20% en bonos.' },
        ],
      })
      cy.request('/api/whatsapp/templates').then((res) => {
        const approved = res.body.templates.find((t: any) => t.name === 'guia_lumbar')
        expect(approved.headerMedia, 'the template brings the file it was made with').to.deep.include({ type: 'document', filename: 'Guia-lumbar.pdf' })
        expect(approved.headerMedia.storage_path).to.match(new RegExp(`^${account.accountId}/templates/guia_lumbar\\.es\\.\\d+\\.Guia-lumbar\\.pdf$`))
        expect(res.body.inReview.map((t: any) => t.name)).to.deep.eq(['oferta_bono'])
      })
      cy.get('[data-cy="whatsapp-templates-refresh"]').click()
      cy.get('[data-cy="whatsapp-templates-in-review"]').should('contain', 'oferta_bono').and('contain', 'Rejected').and('contain', 'has to be Marketing')

      // A send attaches the template's own file, named, without the clinic
      // choosing one of the patient's.
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId: `pnid-${Date.now()}` })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Prueba', phone: '612345678' }).then((patient) => {
        cy.request({
          method: 'POST',
          url: '/api/whatsapp/send',
          body: { patientId: patient.id, templateName: 'guia_lumbar', templateLanguage: 'es', variables: ['Lucía'], headerFormat: 'DOCUMENT', templateMedia: true },
        })
        cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
          const header = sends.at(-1).template.components.find((c: any) => c.type === 'header')
          expect(header.parameters[0].type).to.eq('document')
          expect(header.parameters[0].document.filename).to.eq('Guia-lumbar.pdf')
          expect(header.parameters[0].document.link).to.contain('whatsapp-media')
        })
      })
    })
  })

  it("says Meta's reason when it refuses, and keeps no file behind", () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', { refuseTemplate: 'There is already English (US) content for this template.' })
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      writeGuide('Guía cervical', pdf('cervical.pdf'))
      cy.get('[data-cy="template-error"]').should('contain', 'Meta did not accept the template').and('contain', 'There is already English (US) content')
      cy.get('[data-cy="template-dialog"]').should('exist')

      // Had the file been kept, a template of that name would now bring it.
      cy.task('db:startMetaGraphStub', { templates: [{ name: 'guia_cervical', language: 'es', status: 'APPROVED', header: 'DOCUMENT', body: 'Hola {{1}}, tu guía.' }] })
      cy.request('/api/whatsapp/templates').then((res) => {
        expect(res.body.templates[0].headerMedia).to.be.undefined
      })
    })
  })

  it('refuses a draft Meta would refuse, before asking Meta', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      const form = new FormData()
      form.append('draft', JSON.stringify({ name: 'guia', language: 'es', category: 'UTILITY', header: 'none', body: '{{1}}, tu guía', examples: ['Ana'], footer: '' }))
      cy.window().then((win) =>
        win.fetch('/api/whatsapp/templates', { method: 'POST', body: form }).then(async (res) => {
          expect(res.status).to.eq(400)
          expect(await res.text()).to.contain('cannot start or end with a variable')
        }),
      )
      cy.task<{ creates: unknown[] }>('db:metaGraphStubTemplateCreates').its('creates').should('have.length', 0)
    })
  })
})
