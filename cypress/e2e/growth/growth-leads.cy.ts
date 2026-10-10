// The leads pipeline, now against real rows rather than a fixture.
//
// Everything here seeds its own leads, so the assertions are about behaviour
// the API and the board actually produce -- stage totals, "+N more", time in
// stage, a drag that persists -- rather than about strings someone typed into
// a fixture file.
//
// Cypress cannot perform a native HTML5 drag, so the drag test fires the same
// events a browser would (dragstart on the card, dragover then drop on the
// target column). That is faithful because none of the handlers read
// dataTransfer -- the dragged lead is tracked in component state.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Growth leads pipeline', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('groups leads into stages, with totals taken from every lead not just the visible ones', () => {
    // 27 contacted leads against a board that renders 25, so the column total
    // and the "+N more" have to come from different numbers.
    for (let i = 0; i < 27; i++) {
      cy.task('db:createLead', {
        accountId: account.accountId,
        fullName: `Contacted Lead ${String(i + 1).padStart(2, '0')}`,
        stage: 'contacted',
        estimatedValueCents: 100_000,
      })
    }

    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Ainara Quilez',
      stage: 'qualified',
      source: 'Meta Ads · Back pain',
      aiHandling: true,
      estimatedValueCents: 100_500,
    })

    cy.visit('/growth/leads?growth=1')

    cy.get('[data-test="lead-column-contacted"] [data-test="lead-count"]').should('have.text', '27')
    cy.contains('[data-test="lead-column-contacted"] button', 'Show 2 more').scrollIntoView().should('be.visible')
    // 27 x EUR 1,000 summed server-side, not from the 25 cards on screen.
    cy.get('[data-test="lead-column-contacted"]').should('contain', '27.000 € est.')

    // Seven stages are wider than the viewport, so a column to the right has
    // to be scrolled to before Cypress will call it visible.
    cy.contains('[data-test="lead-column-qualified"]', 'Ainara Quilez').scrollIntoView().should('be.visible')
    cy.contains('AI handling').scrollIntoView().should('be.visible')
    cy.contains('Meta Ads · Back pain').scrollIntoView().should('be.visible')

    // An empty stage explains itself rather than rendering a blank gutter.
    cy.contains('No lost leads').scrollIntoView().should('be.visible')
  })

  it('reaches every card: past the first 25, by search, and in the table', () => {
    // A stage drew 25 cards and the rest were a caption, and the search
    // filtered only those 25 -- so a lead further down a busy stage could not
    // be found from the board at all.
    for (let i = 0; i < 27; i++) {
      cy.task('db:createLead', {
        accountId: account.accountId,
        fullName: `Busy Lead ${String(i + 1).padStart(2, '0')}`,
        stage: 'new',
        phone: `3460055${String(i + 1).padStart(4, '0')}`,
        email: `busy${i + 1}@example.test`,
      })
    }

    cy.visit('/growth/leads?growth=1')
    const column = '[data-test="lead-column-new"]'
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 25)
    // The two oldest are the ones not drawn.
    cy.get(column).should('not.contain', 'Busy Lead 01')

    // By name, by phone however it is typed, by email: all on the server.
    cy.get('input[type="search"]').type('Busy Lead 01')
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 1).and('contain', 'Busy Lead 01')
    // The column still says what the stage holds, not what the search found.
    cy.get(`${column} [data-test="lead-count"]`).should('have.text', '27')

    cy.get('input[type="search"]').clear().type('600 55 0002')
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 1).and('contain', 'Busy Lead 02')

    cy.get('input[type="search"]').clear().type('busy3@example')
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 1).and('contain', 'Busy Lead 03')

    cy.get('input[type="search"]').clear().type('nobody by this name')
    cy.get('[data-test="leads-no-match"]').should('be.visible')

    // "Show 2 more" draws the rest of the stage.
    cy.get('input[type="search"]').clear()
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 25)
    cy.get(`${column} [data-test="lead-column-more"]`).should('have.text', 'Show 2 more').click()
    cy.get(`${column} [data-test="lead-card"]`).should('have.length', 27)
    cy.get(column).should('contain', 'Busy Lead 01')

    // And the table lists everybody.
    cy.contains('button', 'Table').click()
    cy.get('table tbody tr').should('have.length', 27)
  })

  it('reports how long a lead has sat in its stage', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Stale Lead',
      stage: 'new',
      stageChangedAt: twoDaysAgo,
    })

    cy.visit('/growth/leads?growth=1')
    cy.contains('[data-test="lead-column-new"]', '2 d in stage').should('be.visible')
  })

  it('persists a drag, and records the move on the timeline', () => {
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Rubén Ortega',
      stage: 'qualified',
      estimatedValueCents: 124_000,
    }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.intercept('PATCH', '/api/growth/leads/*').as('move')
      cy.get('[data-test="lead-column-qualified"] [data-test="lead-count"]').should('have.text', '1')

      cy.get('[data-test="lead-column-qualified"]').contains('button', 'Rubén Ortega').trigger('dragstart')
      cy.get('[data-test="lead-column-booked"]').trigger('dragover').trigger('drop')

      // The board updates optimistically, so without waiting for the request
      // the database is read while the move is still in flight.
      cy.wait('@move').its('response.statusCode').should('eq', 200)

      cy.get('[data-test="lead-column-booked"]').contains('Rubén Ortega').should('exist')
      cy.get('[data-test="lead-column-booked"] [data-test="lead-count"]').should('have.text', '1')
      cy.get('[data-test="lead-column-qualified"] [data-test="lead-count"]').should('have.text', '0')

      // The board moving is not the point -- the row moving is.
      cy.task('db:leadById', { id: leadId }).should((row) => {
        expect((row as { stage: string }).stage).to.eq('booked')
      })

      // And the move is on the record, because "who moved this to Lost" is
      // the question someone asks a week later.
      cy.task('db:leadEvents', { leadId }).should((events) => {
        const move = (events as { kind: string; title: string }[]).find((e) => e.kind === 'stage_change')
        expect(move, 'a stage_change event').to.exist
        expect(move!.title).to.eq('Moved to Booked')
      })

      // A reload proves it came back from the database rather than living in
      // the page's own state.
      cy.reload()
      cy.get('[data-test="lead-column-booked"]').contains('Rubén Ortega').should('exist')
    })
  })

  it('survives a rejected move by putting the card back', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Doomed Move', stage: 'new' })

    cy.visit('/growth/leads?growth=1')
    cy.intercept('PATCH', '/api/growth/leads/*', { statusCode: 500, body: { statusMessage: 'nope' } }).as('patch')

    cy.get('[data-test="lead-column-new"]').contains('button', 'Doomed Move').trigger('dragstart')
    cy.get('[data-test="lead-column-booked"]').trigger('dragover').trigger('drop')
    cy.wait('@patch')

    // Back where it started, and the counts with it -- not stranded in a
    // stage the server never accepted. The board itself stays on screen:
    // one refused drag must not blank the whole pipeline.
    cy.contains('Could not move that lead. It has been put back.').should('be.visible')
    cy.get('[data-test="leads-error"]').should('not.exist')
    cy.get('[data-test="lead-column-new"]').contains('Doomed Move').should('exist')
    cy.get('[data-test="lead-column-new"] [data-test="lead-count"]').should('have.text', '1')
    cy.get('[data-test="lead-column-booked"] [data-test="lead-count"]').should('have.text', '0')
  })

  it('opens the drawer with the timeline and attribution the API returned', () => {
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Ainara Quilez',
      stage: 'qualified',
      reference: 'LEAD-2026-0918',
      source: 'Meta Ads · Back pain',
      events: [
        { kind: 'form', title: 'Meta lead form submitted', detail: 'Lower back pain for 3 weeks', occurredAt: '2026-09-11T19:42:00Z' },
        {
          kind: 'conversation',
          title: 'AI receptionist · WhatsApp',
          occurredAt: '2026-09-11T19:45:00Z',
          body: {
            messages: [
              { from: 'ai', text: 'Hi Ainara, this is Alba from Clínica Sants.' },
              { from: 'lead', text: 'Comes and goes, worse after work.' },
            ],
          },
        },
        {
          kind: 'appointment',
          title: 'Appointment booked in the clinic calendar',
          occurredAt: '2026-09-11T19:51:00Z',
          body: { slot: 'Initial Assessment · Mon 15 Sep, 19:30', slotDetail: 'Dr. Marta Ferrer · Room 2' },
        },
      ],
      attribution: { campaign: 'ES · Back pain · Sants 5km', firstTouch: 'Instagram Reels · 9 Sep', costCents: 690 },
    })

    cy.visit('/growth/leads?growth=1')
    cy.contains('button', 'Ainara Quilez').click()

    cy.get('[role="dialog"]').within(() => {
      cy.contains('LEAD-2026-0918').should('be.visible')

      cy.contains('Meta lead form submitted').should('be.visible')
      cy.contains('Hi Ainara, this is Alba from Clínica Sants.').should('be.visible')
      cy.contains('Initial Assessment · Mon 15 Sep, 19:30').should('be.visible')

      cy.contains('Campaign').should('be.visible')
      cy.contains('ES · Back pain · Sants 5km').should('be.visible')
      cy.contains('Cost per lead').should('be.visible')
      cy.contains('6,90 €').should('be.visible')

      cy.contains('button', 'Convert to patient').should('be.visible')
    })

    cy.get('body').type('{esc}')
    cy.get('[role="dialog"]').should('not.exist')
  })

  it('leaves the attribution rail out when nothing has been attributed', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Unattributed Walk In', stage: 'new', channel: 'walk_in' })

    cy.visit('/growth/leads?growth=1')
    cy.contains('button', 'Unattributed Walk In').click()

    // Six em-dash placeholders would imply the data was looked for and missing.
    cy.get('[role="dialog"]').within(() => {
      cy.contains('Attribution').should('not.exist')
      cy.contains('Consent').should('not.exist')
    })
  })

  it('shows the set-up checklist to a clinic with no leads at all', () => {
    cy.visit('/growth/leads?growth=1')

    cy.contains('No leads yet').should('be.visible')
    cy.contains('a', 'Connect WhatsApp').should('have.attr', 'href', '/settings/whatsapp')
    cy.get('[data-test="lead-column-new"]').should('not.exist')
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/leads?growth=0')

    cy.contains('Leads are part of the Growth tier.').should('be.visible')
    cy.get('[data-test="lead-column-new"]').should('not.exist')
  })
})
