// The automation builder's step panels -- what the Campaigns editor's
// "action" rows were, now one panel per step type beside the canvas.
//
// Ported from the Campaigns spec, keeping every assertion's intent:
//   - a Wait step shows its own fields and nothing else (the webhook panel
//     used to render under it, as a catch-all v-else);
//   - a wait is stored in minutes whatever unit was chosen;
//   - a WhatsApp header is asked for only when the template declares one;
//   - "Send test to me" says why it failed, not just that it did;
//   - test mode records instead of sending, and says so.

interface SeededAccount {
  email: string
  password: string
  accountId: string
}

const TEMPLATES = {
  templates: [
    { name: 'plain_message', language: 'es', category: 'MARKETING', status: 'APPROVED', bodyText: 'Hola {{1}}', variableCount: 1, urlButtonCount: 0, mediaHeaderFormat: null, buttons: [] },
    { name: 'two_slots', language: 'es', category: 'MARKETING', status: 'APPROVED', bodyText: 'Hola {{1}}, por lo de {{2}}', variableCount: 2, urlButtonCount: 0, mediaHeaderFormat: null, buttons: [] },
    { name: 'with_location', language: 'es', category: 'MARKETING', status: 'APPROVED', bodyText: 'Aquí estamos', variableCount: 0, urlButtonCount: 0, mediaHeaderFormat: 'LOCATION', buttons: [] },
    { name: 'with_video', language: 'en', category: 'MARKETING', status: 'APPROVED', bodyText: 'Hi {{1}}', variableCount: 1, urlButtonCount: 0, mediaHeaderFormat: 'VIDEO', buttons: [] },
    {
      name: 'with_button',
      language: 'es',
      category: 'UTILITY',
      status: 'APPROVED',
      bodyText: 'Hola {{1}}, reserva aquí',
      variableCount: 1,
      urlButtonCount: 1,
      mediaHeaderFormat: null,
      buttons: [{ type: 'URL', text: 'Reservar', dynamic: true }],
    },
  ],
}

describe('Automation builder: step panels', () => {
  beforeEach(() => {
    // Stubbed at the network edge, because the template list comes from Meta
    // and a test account has no WhatsApp credentials -- without it the list
    // is empty and the header tests would pass against a vacuum.
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: TEMPLATES }).as('templates')
    cy.seedStaffAccount().then((seeded) => {
      const account = seeded as SeededAccount
      cy.wrap(account.accountId).as('accountId')
      cy.login(account.email, account.password)
    })
    cy.visit('/automations/new')
    // Hydrated before clicking: a click on server-rendered markup Vue has
    // not claimed does nothing, and reads as a missing menu.
    cy.get('[data-test="node-trigger"]').should('be.visible')
    cy.get('[data-test="insert-root-root-0"]').should('be.visible')
  })

  function addStep(type: string, insert = 'insert-root-root-0') {
    cy.get(`[data-test="${insert}"]`).click()
    cy.get(`[data-test="add-step-${type}"]`).click()
    cy.get('[data-test="inspector"]').should('be.visible')
  }

  it('offers a Wait step and shows only its own fields', () => {
    addStep('delay')
    cy.get('[data-test="delay-config"]').within(() => {
      cy.get('input[type="number"]').should('have.value', '1')
      cy.get('select').should('have.value', 'days')
    })
    // The limit named where it is decided, rather than discovered by someone
    // whose 30-second wait became 15 minutes.
    cy.get('[data-test="inspector"]').should('contain', 'checked every 15 minutes')
    // The regression: a Wait must not drag the webhook fields in with it.
    cy.contains('Signing secret').should('not.exist')
    cy.get('[data-test="webhook-url"]').should('not.exist')
  })

  it('saves a wait in minutes, whatever unit was chosen', () => {
    addStep('delay')
    cy.get('[data-test="delay-config"]').within(() => {
      cy.get('input[type="number"]').clear().type('2')
      cy.get('select').select('hours')
    })
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)

    // Two hours is stored as 120 minutes: one unit underneath, because the
    // clock that runs it thinks in minutes.
    cy.get<string>('@accountId').then((accountId) => {
      cy.task('db:latestAutomationActions', { accountId }).then((rows) => {
        const delay = (rows as { action_type: string; config: { delay_minutes?: number } }[]).find((a) => a.action_type === 'delay')
        expect(delay, 'a delay step').to.not.be.undefined
        expect(delay!.config.delay_minutes).to.eq(120)
      })
    })
  })

  it('asks for a header only when the template declares one', () => {
    cy.wait('@templates')
    addStep('whatsapp_template')

    cy.get('[data-test="template-select"]').select('plain_message::es')
    cy.get('[data-test="header-location"]').should('not.exist')
    cy.get('[data-test="header-media"]').should('not.exist')
    // The body, with its variable named rather than numbered.
    cy.get('[data-test="template-preview"]').should('contain', 'First name')

    cy.get('[data-test="template-select"]').select('with_location::es')
    cy.get('[data-test="header-location"]').should('be.visible')
    cy.get('[data-test="header-media"]').should('not.exist')

    cy.get('[data-test="template-select"]').select('with_video::en')
    cy.get('[data-test="header-media"]').should('be.visible')
    cy.get('[data-test="header-location"]').should('not.exist')

    // A dynamic URL button says what its link carries.
    cy.get('[data-test="template-select"]').select('with_button::es')
    cy.get('[data-test="button-slot-0"]').should('contain', 'Reservar').find('select').select('phone')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.get<string>('@accountId').then((accountId) => {
      cy.task('db:latestAutomationActions', { accountId }).then((rows) => {
        const wa = (rows as { action_type: string; config: Record<string, any> }[]).find((a) => a.action_type === 'whatsapp_template')!
        expect(wa.config.template_name).to.eq('with_button')
        expect(wa.config.variables).to.deep.eq([{ source: 'first_name' }])
        expect(wa.config.button_params).to.deep.eq([{ source: 'phone' }])
        expect(wa.config.doc_template_ids).to.deep.eq([null])
      })
    })
  })

  // An unassigned slot is sent as the first name (so Meta does not refuse
  // the message) -- which is how "por lo de {{2}}" went out as "por lo de
  // Martín" in production. The panel says so until something is chosen.
  it('warns about a template variable nothing fills, until something does', () => {
    // As in production: saved with one variable, on a template that has since
    // gained a second -- the old Campaigns editor never said so.
    cy.get<string>('@accountId').then((accountId) => {
      cy.task<{ id: string }>('auto:createFlowRule', {
        accountId,
        triggerEvent: 'appointment.completed',
        steps: [{ type: 'whatsapp_template', config: { template_name: 'two_slots', template_language: 'es', variables: [{ source: 'first_name' }] } }],
      }).then((rule) => {
        cy.task<{ id: string }[]>('auto:actionsForRule', { ruleId: rule.id }).then((actions) => {
          cy.visit(`/automations/${rule.id}`)
          cy.wait('@templates')
          cy.get(`[data-test="node-${actions[0].id}"]`).click()
          cy.get('[data-test="variable-2-unassigned"]').should('contain', 'sent as the person').and('contain', '{{2}}')
          cy.get('[data-test="variable-1-unassigned"]').should('not.exist')

          // A fixed value left blank is still nothing.
          cy.get('[data-test="variable-2"] select').select('text')
          cy.get('[data-test="variable-2-unassigned"]').should('exist')
          cy.get('[data-test="variable-2"] input').type('tu espalda')
          cy.get('[data-test="variable-2-unassigned"]').should('not.exist')
        })
      })
    })
  })

  // A lead automation can fill a slot with a form answer -- one option per
  // question the clinic's lead forms have asked.
  it('offers the questions leads answered as variables of a lead automation', () => {
    cy.get<string>('@accountId').then((accountId) => {
      cy.task('db:createLead', {
        accountId,
        fullName: 'Pablo Formulario',
        channel: 'facebook',
        events: [{ kind: 'qualification', title: 'Submitted the form', body: { answers: [{ question: '¿Cuál sería el motivo de tu consulta?', answer: 'Cervicales' }] } }],
      })
      cy.task<{ id: string }>('auto:createFlowRule', {
        accountId,
        triggerEvent: 'lead.created',
        steps: [{ type: 'whatsapp_template', config: { template_name: 'two_slots', template_language: 'es', variables: [{ source: 'first_name' }, { source: '' }] } }],
      }).then((rule) => {
        cy.task<{ id: string }[]>('auto:actionsForRule', { ruleId: rule.id }).then((actions) => {
          cy.visit(`/automations/${rule.id}`)
          cy.wait('@templates')
          cy.get(`[data-test="node-${actions[0].id}"]`).click()
          cy.get('[data-test="variable-2"] select').select('answer_cual_seria_el_motivo_de_tu_consulta')
          cy.get('[data-test="variable-2-unassigned"]').should('not.exist')
          cy.get('[data-test="template-preview"]').should('contain', '¿Cuál sería el motivo de tu consulta?')
          cy.get('[data-test="variables-lead-hint"]').should('contain', 'answered on the form')
        })
      })
    })
  })

  it('says why a test send failed instead of just that it did', () => {
    // No Resend key is configured against the test environment. The old code
    // turned that into silence, then into "Failed to send test."; it now
    // names the cause.
    addStep('email')
    cy.get('[data-test="email-subject"]').type('Prueba')
    cy.get('[data-test="email-body"]').type('Hola')
    cy.get('[data-test="send-test"]').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.get('[data-test="test-result"]').should('contain', 'not configured').and('not.contain', 'Failed to send')
  })

  it('offers a test mode that records instead of sending', () => {
    cy.get('[data-test="tab-settings"]').click()
    cy.get('[data-test="dry-run-toggle"]').should('have.attr', 'aria-checked', 'false').click()
    cy.get('[data-test="dry-run-toggle"]').should('have.attr', 'aria-checked', 'true')
    cy.contains('records what it would have sent instead of sending it').should('exist')
  })
})
