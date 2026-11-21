// Everything Meta's template builder offers that a clinic can use, made from
// QuiroFlow's: a heading with a variable, a map at the top, and every kind of
// button -- quick replies, a link that ends in each person's phone, a call
// button, a code to copy -- beside the form button that came first.
//
// Two things are worth proving end to end. What goes to Meta when the
// template is submitted (POST /{waba}/message_templates), and what goes to
// Meta when it is SENT: Meta refuses the whole send when a part that takes a
// value goes without one, so what the clinic chose in the creator has to come
// back on every send -- here a send by hand from a patient's record. Meta is
// the local Graph stub (db:startMetaGraphStub); nothing reaches the real one.
// The staff UI runs in English here; the template itself is in Spanish.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

function connect(account: Account) {
  cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '232335383285622' })
  cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
}

const button = (i: number) => cy.get(`[data-cy="template-button-${i}"]`)

// What Meta keeps for the confirmation template below, as its list returns it.
const CONFIRMATION_BUTTONS = [
  { type: 'QUICK_REPLY', text: 'Sí, voy' },
  { type: 'QUICK_REPLY', text: 'No puedo' },
  { type: 'URL', text: 'Cambiar cita', url: 'https://clinica.example/cambiar?phone={{1}}', example: ['https://clinica.example/cambiar?phone=34600000000'] },
  { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34600000000' },
  { type: 'COPY_CODE', example: 'BIENVENIDA10' },
]

describe('Making a WhatsApp template with every kind of button', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('submits a heading and every kind of button, and a send fills each as the template was made', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()

      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-title"]').type('Confirmar visita')

        // A heading, with its one variable and a sample for Meta.
        cy.get('[data-cy="template-header-text"]').click()
        cy.get('[data-cy="template-heading-text"]').type('Hola')
        cy.get('[data-cy="template-heading-add-variable"]').click()
        cy.get('[data-cy="template-heading-text"]').should('have.value', 'Hola {{1}}')
        cy.get('[data-cy="template-heading-example"]').should('have.value', 'Ana')
        cy.get('[data-cy="template-heading-source"]').should('have.value', 'first_name')
        cy.get('[data-cy="template-preview-header"]').should('have.text', 'Hola Ana')

        cy.get('[data-cy="template-body"]').type('Tu primera visita es mañana a las diez. ¿Nos confirmas que vienes?')

        // Quick replies first, then a link, a call and a code.
        cy.get('[data-cy="template-add-button-quick_reply"]').click()
        cy.get('[data-cy="template-add-button-quick_reply"]').click()
        cy.get('[data-cy="template-add-button-url"]').click()
        cy.get('[data-cy="template-add-button-phone"]').click()
        cy.get('[data-cy="template-add-button-copy_code"]').click()
        // One call button and one code are all Meta allows.
        cy.get('[data-cy="template-add-button-phone"]').should('be.disabled')
        cy.get('[data-cy="template-add-button-copy_code"]').should('be.disabled')
        cy.get('[data-cy="template-button-count"]').should('have.text', '5/10')

        // Empty buttons and a link with no sample are caught before Meta is asked.
        button(2).find('[data-cy="template-button-dynamic"]').click()
        cy.get('[data-cy="template-submit"]').click()
        cy.get('[data-cy="template-problems"]')
          .should('contain', 'Button 1: write what it says.')
          .and('contain', 'Button 3: give an example of the end of the link')
          .and('contain', 'Button 4: write the phone number.')
          .and('contain', 'Button 5: write the code it copies.')

        button(0).find('[data-cy="template-button-text"]').type('Sí, voy')
        button(1).find('[data-cy="template-button-text"]').type('No puedo')
        button(2).within(() => {
          cy.get('[data-cy="template-button-text"]').type('Cambiar cita')
          cy.get('[data-cy="template-button-url"]').clear().type('https://clinica.example/cambiar?phone=')
          cy.get('[data-cy="template-button-suffix"]').should('have.value', 'phone')
          cy.get('[data-cy="template-button-example"]').type('34600000000')
          cy.get('[data-cy="template-button-url-preview"]').should('have.text', 'https://clinica.example/cambiar?phone=34600000000')
        })
        button(3).within(() => {
          cy.get('[data-cy="template-button-text"]').clear().type('Llamar')
          cy.get('[data-cy="template-button-phone"]').type('+34 600 000 000')
        })
        button(4).find('[data-cy="template-button-code"]').type('BIENVENIDA10')

        // Past three buttons WhatsApp shows two and "See all options".
        cy.get('[data-cy="template-preview-button"]').should('have.length', 2).first().should('contain', 'Sí, voy')
        cy.get('[data-cy="template-preview-all-options"]').should('contain', 'See all options')

        cy.get('[data-cy="template-submit"]').click()
      })
      cy.get('[data-cy="template-dialog"]').should('not.exist')
      cy.get('[data-cy="whatsapp-template-created"]').should('contain', 'confirmar_visita')

      cy.task<{ creates: any[] }>('db:metaGraphStubTemplateCreates').then(({ creates }) => {
        expect(creates).to.have.length(1)
        expect(creates[0]).to.deep.include({ name: 'confirmar_visita', language: 'es', category: 'UTILITY' })
        expect(creates[0].components).to.deep.eq([
          { type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}', example: { header_text: ['Ana'] } },
          { type: 'BODY', text: 'Tu primera visita es mañana a las diez. ¿Nos confirmas que vienes?' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'QUICK_REPLY', text: 'Sí, voy' },
              { type: 'QUICK_REPLY', text: 'No puedo' },
              { type: 'URL', text: 'Cambiar cita', url: 'https://clinica.example/cambiar?phone={{1}}', example: ['https://clinica.example/cambiar?phone=34600000000'] },
              { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34600000000' },
              { type: 'COPY_CODE', example: 'BIENVENIDA10' },
            ],
          },
        ])
      })

      // Meta approves it. A send names no heading, link or code: they come
      // from what the creator kept, and the heading is the patient's name.
      cy.task('db:startMetaGraphStub', {
        templates: [
          {
            name: 'confirmar_visita',
            language: 'es',
            status: 'APPROVED',
            header: 'TEXT',
            headerText: 'Hola {{1}}',
            headerExample: 'Ana',
            body: 'Tu primera visita es mañana a las diez. ¿Nos confirmas que vienes?',
            buttons: CONFIRMATION_BUTTONS,
          },
        ],
      })
      cy.request('/api/whatsapp/templates').then((res) => {
        const tpl = res.body.templates.find((x: any) => x.name === 'confirmar_visita')
        expect(tpl.sendValues).to.deep.eq({
          header: { source: 'first_name' },
          buttons: [{ payload: 'Sí, voy' }, { payload: 'No puedo' }, { suffix: { source: 'phone' } }, null, { code: 'BIENVENIDA10' }],
        })
      })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId: `pnid-${Date.now()}` })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Prueba', phone: '612345678' }).then((patient) => {
        cy.request({ method: 'POST', url: '/api/whatsapp/send', body: { patientId: patient.id, templateName: 'confirmar_visita', templateLanguage: 'es', variables: [], personal: true } })
        cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
          expect(sends.at(-1).template).to.deep.eq({
            name: 'confirmar_visita',
            language: { code: 'es' },
            components: [
              { type: 'header', parameters: [{ type: 'text', text: 'Lucía' }] },
              { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'Sí, voy' }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'No puedo' }] },
              { type: 'button', sub_type: 'url', index: '2', parameters: [{ type: 'text', text: '34612345678' }] },
              { type: 'button', sub_type: 'copy_code', index: '4', parameters: [{ type: 'coupon_code', coupon_code: 'BIENVENIDA10' }] },
            ],
          })
        })
      })

    })
  })

  it('puts the clinic on a map at the top, and every send shows that place', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()

      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-title"]').type('Como llegar')
        cy.get('[data-cy="template-header-location"]').click()
        cy.get('[data-cy="template-body"]').type('Te esperamos en la clínica. Aquí tienes cómo llegar.')
        cy.get('[data-cy="template-submit"]').click()
        cy.get('[data-cy="template-problems"]').should('contain', 'Give the location its latitude and longitude.')

        cy.get('[data-cy="template-location-name"]').clear().type('Clínica Demo')
        cy.get('[data-cy="template-location-address"]').clear().type('Calle Mayor 1, Madrid')
        // Both numbers at once, pasted as Google Maps copies them.
        cy.get('[data-cy="template-location-latitude"]').invoke('val', '40.4168, -3.7038').trigger('input')
        cy.get('[data-cy="template-location-latitude"]').should('have.value', '40.4168')
        cy.get('[data-cy="template-location-longitude"]').should('have.value', '-3.7038')
        cy.get('[data-cy="template-preview-header"]').should('contain', 'Clínica Demo').and('contain', 'Calle Mayor 1, Madrid')
        cy.get('[data-cy="template-submit"]').click()
      })
      cy.get('[data-cy="template-dialog"]').should('not.exist')

      cy.task<{ creates: any[] }>('db:metaGraphStubTemplateCreates').then(({ creates }) => {
        expect(creates[0].components).to.deep.eq([
          { type: 'HEADER', format: 'LOCATION' },
          { type: 'BODY', text: 'Te esperamos en la clínica. Aquí tienes cómo llegar.' },
        ])
      })

      cy.task('db:startMetaGraphStub', {
        templates: [{ name: 'como_llegar', language: 'es', status: 'APPROVED', header: 'LOCATION', body: 'Te esperamos en la clínica. Aquí tienes cómo llegar.' }],
      })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId: `pnid-${Date.now()}` })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Prueba', phone: '612345678' }).then((patient) => {
        // The send names no place: the template's own goes.
        cy.request({ method: 'POST', url: '/api/whatsapp/send', body: { patientId: patient.id, templateName: 'como_llegar', templateLanguage: 'es', variables: [], headerFormat: 'LOCATION', personal: true } })
        cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
          expect(sends.at(-1).template.components).to.deep.eq([
            { type: 'header', parameters: [{ type: 'location', location: { latitude: '40.4168', longitude: '-3.7038', name: 'Clínica Demo', address: 'Calle Mayor 1, Madrid' } }] },
          ])
        })
      })
    })
  })

  it('keeps the quick replies together, as Meta requires', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()

      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-add-button-url"]').click()
        cy.get('[data-cy="template-add-button-quick_reply"]').click()
        // A call added now goes beside the link, not after the quick reply.
        cy.get('[data-cy="template-add-button-phone"]').click()
        cy.get('[data-cy^="template-button-"][data-kind]').then(($b) => {
          expect([...$b].map((el) => el.getAttribute('data-kind'))).to.deep.eq(['url', 'phone', 'quick_reply'])
        })
        // Moving the quick reply between the others is refused before Meta sees it.
        button(2).find('button[aria-label="Move up"]').click()
        cy.get('[data-cy="template-submit"]').click()
        cy.get('[data-cy="template-problems"]').should('contain', 'Put the quick replies together')
        // Two links are Meta's limit, a form counting as one.
        cy.get('[data-cy="template-add-button-url"]').click()
        cy.get('[data-cy="template-add-button-url"]').should('be.disabled')
        cy.get('[data-cy="template-add-button-form"]').should('be.disabled')
      })
    })
  })
})
