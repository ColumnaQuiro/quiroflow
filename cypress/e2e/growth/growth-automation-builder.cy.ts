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

          // What goes out when a lead skipped the question: an empty variable
          // makes Meta refuse the whole message.
          cy.get('[data-test="variable-2"] [data-test="answer-fallback"]').should('have.attr', 'placeholder').and('contain', 'tu consulta')
          cy.get('[data-test="variable-2"] [data-test="answer-fallback"]').type('tu dolor')
          cy.get('[data-test="variable-1"] [data-test="answer-fallback"]').should('not.exist')
          cy.get('[data-test="save"]').click()
          // Saved, before reading it back (cy.task does not retry).
          cy.get('[data-test="save-bar"]').should('not.exist')
          cy.task<{ config: Record<string, any> }[]>('auto:actionsForRule', { ruleId: rule.id }).should((rows) => {
            expect(rows[0]!.config.variables[1]).to.deep.eq({ source: 'answer_cual_seria_el_motivo_de_tu_consulta', fallback: 'tu dolor' })
          })
          // Back to a plain field, the fallback goes with it.
          cy.get('[data-test="variable-2"] select').select('first_name')
          cy.get('[data-test="variable-2"] [data-test="answer-fallback"]').should('not.exist')
        })
      })
    })
  })

  it('says why a test send failed instead of just that it did', () => {
    // No Resend key is configured against the test environment. The old code
    // turned that into silence, then into "Failed to send test."; it now
    // names the cause.
    addStep('email')
    cy.get('[data-test="email-builder-subject"]').type('Prueba')
    cy.get('[data-test="email-builder-send-test"]').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.get('[data-test="test-result"]').should('contain', 'not configured').and('not.contain', 'Failed to send')
  })

  // The canvas is the real email, filled with the example patient; its body is
  // patched in place as it changes, so it is read from the frame's document.
  const canvas = () => cy.get('[data-test="email-builder-canvas"]').its('0.contentDocument.body').should('not.be.empty')

  it('opens a new email in the block editor, already written, and previews it as it goes out', () => {
    addStep('email')
    cy.get('[data-test="email-builder"]').should('be.visible')
    cy.get('[data-test="email-builder-subject"]').type('Te echamos de menos, {{first_name}}', { parseSpecialCharSequences: false })
    canvas().should('contain', 'Hola Lucía').and('contain', 'Reserva tu próxima cita')
    canvas().find('a').filter(':contains("Reserva tu próxima cita")').should('have.attr', 'href').and('match', /\/book\//)

    // A block, from the palette: under the selected one, and selected itself.
    cy.get('[data-test="email-add-divider"]').click()
    cy.get('[data-test="block-settings"]').should('contain', 'Divider')
    cy.get('[data-test="email-block-list"] li').should('have.length', 6)

    // The button's words and where it goes.
    cy.get('[data-test="email-block-button"]').click()
    cy.get('[data-test="block-button-text"]').clear().type('Pide tu cita')
    cy.get('[data-test="block-button-link"]').select('review')
    canvas().find('a').filter(':contains("Pide tu cita")').should('have.attr', 'href', 'https://g.page/r/ejemplo/review')

    // On a phone's width.
    cy.get('[data-test="email-builder-mobile"]').click()
    cy.get('[data-test="email-builder-canvas"]').should('have.css', 'width', '375px')

    // Back on the flow, the drawer previews the same email, and Save stores the blocks.
    cy.get('[data-test="email-builder-done"]').click()
    cy.get('[data-test="email-builder"]').should('not.exist')
    cy.get('[data-test="email-preview-subject"]').should('have.text', 'Te echamos de menos, Lucía')
    cy.get('[data-test="email-preview"] iframe').should('have.attr', 'srcdoc').and('contain', 'Pide tu cita').and('contain', 'role="presentation"')
  })

  it('inserts fields from the picker as chips, and saves them as {{key}}', () => {
    addStep('email')
    // Typing "{{" opens the picker filtered by what follows; Enter takes the first match.
    cy.get('[data-test="email-builder-subject"]').type('Hola {{first', { parseSpecialCharSequences: false })
    cy.get('[data-test="variable-picker"]').should('contain', 'First name')
    cy.get('[data-test="email-builder-subject"]').type('{enter}')
    cy.get('[data-test="email-builder-subject"]').should('have.value', 'Hola {{first_name}}')
    // From the toolbar of the selected text block, searched by name; it lands as a chip.
    cy.get('[data-test="email-block-text"]').click()
    cy.get('[data-test="block-settings"] [data-test="email-body"]').type(' Déjanos tu opinión: ')
    cy.get('[data-test="block-settings"] [data-test="email-body-fields"]').click()
    cy.get('[data-test="variable-search"]').type('review{enter}')
    cy.get('[data-test="variable-picker"]').should('not.exist')
    cy.get('[data-test="block-settings"] [data-test="email-body"] [data-var="google_review_link"]').should('contain', 'Google review link')
    canvas().should('contain', 'g.page/r/ejemplo/review')
  })

  it('keeps an email written in the plain editor as it is, until someone switches it to blocks', function () {
    // Recalls written before the block editor are already sending; nothing
    // may change them on its own.
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: this.accountId,
      triggerEvent: 'appointment.completed',
      enabled: false,
      actions: [{ type: 'email', config: { subject: 'Gracias', body: '<p>Gracias por venir, {{first_name}}.</p>', booking_button: true } }],
    }).then((rule) => {
      cy.visit(`/automations/${rule.id}`)
      cy.contains('[data-test^="node-"]', 'Gracias').click()
      cy.get('[data-test="email-builder"]').should('not.exist')
      cy.get('[data-test="email-body"]').should('contain', 'Gracias por venir')
      cy.get('[data-test="email-preview"] iframe').should('have.attr', 'srcdoc').and('contain', 'Reserva tu próxima cita').and('not.contain', 'role="presentation"')
      // Switched: the body comes along in a text block, and the button stays a button.
      cy.get('[data-test="email-switch-blocks"]').click()
      cy.get('[data-test="email-block-list"] li').should('have.length', 2)
      canvas().should('contain', 'Gracias por venir, Lucía').and('contain', 'Reserva tu próxima cita')
      cy.get('[data-test="email-builder-done"]').click()
      cy.get('[data-test="save"]').click()
      cy.get('[data-test="save-bar"]').should('not.exist')
      cy.task<{ config: Record<string, any> }[]>('auto:actionsForRule', { ruleId: rule.id }).should((rows) => {
        expect(rows[0]!.config.design.blocks.map((x: { type: string }) => x.type)).to.deep.eq(['text', 'button'])
        expect(rows[0]!.config.design.blocks[0].html).to.eq('<p>Gracias por venir, {{first_name}}.</p>')
      })
    })
  })

  it('offers a test mode that records instead of sending', () => {
    cy.get('[data-test="tab-settings"]').click()
    cy.get('[data-test="dry-run-toggle"]').should('have.attr', 'aria-checked', 'false').click()
    cy.get('[data-test="dry-run-toggle"]').should('have.attr', 'aria-checked', 'true')
    cy.contains('records what it would have sent instead of sending it').should('exist')
  })
})
