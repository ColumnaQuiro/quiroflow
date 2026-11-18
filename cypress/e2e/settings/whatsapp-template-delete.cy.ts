// Deleting a WhatsApp template at Meta, from Settings > WhatsApp beside Edit.
//
// What matters: only that one language goes (hsm_id + name, not the name
// alone, which Meta reads as every language of it), and a template something
// still sends is refused with what sends it -- Meta fails every send on a
// deleted template, so otherwise confirmations or a drip would just stop.
// Meta is the local Graph stub (db:startMetaGraphStub). The staff UI runs in
// English here.

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

function openApprovedList() {
  cy.get('[data-cy="whatsapp-templates-all"]').then(($details) => {
    if (!$details.prop('open')) cy.wrap($details).find('summary').click()
  })
}

const TEMPLATES = [
  { name: 'oferta_verano', language: 'es', status: 'APPROVED', category: 'MARKETING' as const, body: 'Hola {{1}}, este verano tienes un 10% en bonos.', examples: ['Ana'] },
  { name: 'oferta_verano', language: 'en', status: 'APPROVED', category: 'MARKETING' as const, body: 'Hi {{1}}, 10% off packages this summer.', examples: ['Ana'] },
  { name: 'guia_cervical', language: 'es', status: 'REJECTED', rejectedReason: 'INVALID_FORMAT', body: 'Hola {{1}}, tu guía.', examples: ['Ana'] },
]

describe('Deleting a WhatsApp template', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('deletes one language of an approved template, and a rejected one, at Meta', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', { templates: TEMPLATES })
      connect(account)
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      openApprovedList()
      cy.get('[data-cy="whatsapp-templates-all"] [data-template-delete="oferta_verano"]').should('have.length', 2).first().click()
      cy.get('[data-cy="confirm-dialog"]').within(() => {
        cy.contains('h2', 'Delete “oferta_verano” (es)?')
        cy.contains('in this language only')
        cy.get('[data-cy="confirm-dialog-confirm"]').click()
      })
      cy.get('[data-cy="confirm-dialog"]').should('not.exist')
      cy.get('[data-cy="whatsapp-template-deleted"]').should('contain', 'oferta_verano')

      // The English one is still there; the Spanish one is gone.
      openApprovedList()
      cy.get('[data-cy="whatsapp-templates-all"] [data-template-row="oferta_verano"]').should('have.length', 1).and('contain', '· en')

      // Rejected ones can go too, from the "Waiting on Meta" list.
      cy.get('[data-cy="whatsapp-templates-in-review"] [data-template-delete="guia_cervical"]').click()
      cy.get('[data-cy="confirm-dialog-confirm"]').click()
      cy.get('[data-cy="whatsapp-templates-in-review"]').should('not.exist')

      cy.task<{ deletes: { hsm_id: string; name: string }[] }>('db:metaGraphStubTemplateCreates').its('deletes').should('deep.eq', [
        { hsm_id: 'tpl-oferta_verano-es', name: 'oferta_verano' },
        { hsm_id: 'tpl-guia_cervical-es', name: 'guia_cervical' },
      ])
    })
  })

  it('refuses one an automation still sends, and says which', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', { templates: TEMPLATES })
      connect(account)
      cy.task('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'appointment.booked',
        name: 'Oferta de verano',
        actions: [{ type: 'whatsapp_template', config: { template_name: 'oferta_verano', template_language: 'es', variables: [{ source: 'first_name' }] } }],
      })
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')

      openApprovedList()
      cy.get('[data-cy="whatsapp-templates-all"] [data-template-delete="oferta_verano"]').first().click()
      cy.get('[data-cy="confirm-dialog-confirm"]').click()
      cy.get('[data-cy="whatsapp-template-delete-in-use"]').should('contain', 'Automation "Oferta de verano"')
      cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
      cy.get('[data-cy="confirm-dialog-cancel"]').click()

      cy.task<{ deletes: unknown[] }>('db:metaGraphStubTemplateCreates').its('deletes').should('have.length', 0)
    })
  })
})
