// The Growth tier in the shared Inbox, now against real message rows.
//
// Lead conversations are rows in whatsapp_messages carrying a lead_id -- the
// same table the patient threads come from. Two things matter here, and the
// first matters more:
//
//   1. Without the tier, /inbox is exactly what it was. This page serves real
//      clinics today.
//   2. With it, a lead's thread appears in the same list, and the AI can be
//      taken off it by a person.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

function seedConversation(account: SeededAccount, name: string, aiState: string, opts: { lastInboundMinutesAgo?: number } = {}) {
  return cy
    .task('db:createLead', { accountId: account.accountId, fullName: name, stage: 'contacted', phone: '+34600444901', source: 'Meta Ads · Back pain' })
    .then((lead) => {
      const leadId = (lead as { id: string }).id
      cy.task('db:createLeadMessage', {
        accountId: account.accountId,
        leadId,
        direction: 'inbound',
        body: `Hola, soy ${name}`,
        createdAt: new Date(Date.now() - (opts.lastInboundMinutesAgo ?? 5) * 60000).toISOString(),
      })
      if (aiState !== 'none') {
        cy.request({ method: 'POST', url: `/api/growth/leads/${leadId}/ai-state`, body: { state: aiState }, failOnStatusCode: false })
      }
      return cy.wrap(leadId, { log: false })
    })
}

describe('Growth in the shared Inbox', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('leaves the Inbox untouched for an account without the tier', () => {
    cy.visit('/inbox?growth=0')

    cy.contains('Inbox').should('be.visible')
    cy.get('[data-test="lead-row"]').should('not.exist')
    cy.get('[data-test="filter-ai-handling"]').should('not.exist')

    // The filters the base plan has always had are still there.
    cy.contains('button', 'Awaiting us').should('be.visible')
    cy.contains('button', 'Awaiting patient').should('be.visible')
  })

  it('shows a lead conversation alongside the patient threads', () => {
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Camila Restrepo', 'handling')
    cy.reload()

    cy.contains('[data-test="lead-row"]', 'Camila Restrepo').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'Hola, soy Camila Restrepo').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'AI handling').should('be.visible')
  })

  it('locks the composer while the AI is answering, and opens it on take over', () => {
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Lucia Moreno', 'handling').then((leadId) => {
      cy.reload()
      cy.contains('[data-test="lead-row"]', 'Lucia Moreno').click()

      cy.get('[data-test="lead-thread"]').within(() => {
        cy.contains('AI is handling this conversation').should('be.visible')
        cy.contains('Composer locked while the AI is replying').should('be.visible')
      })
      cy.get('[data-test="lead-composer"]').should('not.exist')

      cy.get('[data-test="take-over"]').click()

      cy.get('[data-test="lead-thread"]').within(() => {
        cy.contains('AI paused').should('be.visible')
      })
      cy.get('[data-test="lead-composer"]').should('be.visible')

      // Persisted, and it records WHO -- two people on one escalated thread
      // is the failure the control exists to prevent.
      cy.task('db:leadAiState', { id: leadId }).should((row) => {
        const state = row as { ai_state: string; ai_handling: boolean; ai_taken_over_by: string | null }
        expect(state.ai_state).to.eq('paused')
        expect(state.ai_taken_over_by, 'the person who took over').to.be.a('string')
        // The legacy boolean the board reads stays in step.
        expect(state.ai_handling).to.eq(false)
      })

      cy.get('[data-test="hand-back"]').click()
      cy.contains('AI is handling this conversation').should('be.visible')
      cy.task('db:leadAiState', { id: leadId }).should((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('handling')
        expect((row as { ai_taken_over_by: string | null }).ai_taken_over_by, 'cleared on hand back').to.eq(null)
      })
    })
  })

  it('holds the receptionist draft back for approval, with the composer still locked', () => {
    // The whole promise of drafting: the model writes, a person decides. If
    // the draft could send itself, none of the rest of this matters.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Draft Waiting', 'handling').then((leadId) => {
      cy.task('db:setLeadDraft', { id: leadId, body: 'Hola, tenemos hueco el jueves a las 10:00.' })
      cy.reload()
      cy.contains('[data-test="lead-row"]', 'Draft Waiting').click()

      cy.get('[data-test="lead-draft"]').within(() => {
        cy.contains('Hola, tenemos hueco el jueves a las 10:00.').should('be.visible')
        cy.contains('Nothing sends without your approval').should('be.visible')
      })

      // Still the AI's thread -- a draft is not a takeover.
      cy.get('[data-test="lead-composer"]').should('not.exist')
      cy.contains('Composer locked while the AI is replying').should('be.visible')
    })
  })

  it('sends what the person edited, not what the model wrote, and clears the draft', () => {
    // Stubbed at the send route on purpose: whether WhatsApp accepts a message
    // is covered where sending lives. What is new here is which text reaches
    // it, and that approving does not leave a draft behind to send twice.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Edit Before Send', 'handling').then((leadId) => {
      cy.task('db:setLeadDraft', { id: leadId, body: 'Te llamamos mañana.' })
      cy.reload()
      cy.intercept('POST', '/api/whatsapp/inbox-send', { statusCode: 200, body: { ok: true } }).as('send')
      cy.intercept('DELETE', '**/draft-reply').as('clearDraft')
      cy.contains('[data-test="lead-row"]', 'Edit Before Send').click()

      cy.get('[data-test="edit-lead-draft-start"]').click()
      cy.get('[data-test="edit-lead-draft"]').clear().type('Te escribimos mañana por la mañana.')
      cy.get('[data-test="approve-lead-draft"]').click()

      cy.wait('@send').its('request.body').should('deep.equal', {
        leadId,
        text: 'Te escribimos mañana por la mañana.',
      })

      // Waited for rather than assumed: the thread reloads twice here, and
      // the card is briefly absent during a reload whether or not the draft
      // was actually cleared.
      cy.wait('@clearDraft').its('response.statusCode').should('eq', 200)
      cy.get('[data-test="lead-draft"]').should('not.exist')
      cy.task('db:leadDraft', { id: leadId }).should((row) => {
        const saved = row as { ai_draft_body: string | null; ai_draft_created_at: string | null }
        expect(saved.ai_draft_body, 'cleared once sent').to.be.null
        expect(saved.ai_draft_created_at).to.be.null
      })
    })
  })

  it('leaves nothing behind when a draft is discarded', () => {
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Discard Me', 'handling').then((leadId) => {
      cy.task('db:setLeadDraft', { id: leadId, body: 'Un borrador que no queremos.' })
      cy.reload()
      cy.intercept('POST', '/api/whatsapp/inbox-send').as('send')
      cy.contains('[data-test="lead-row"]', 'Discard Me').click()

      cy.get('[data-test="discard-lead-draft"]').click()
      cy.get('[data-test="lead-draft"]').should('not.exist')

      cy.task('db:leadDraft', { id: leadId }).should((row) => {
        expect((row as { ai_draft_body: string | null }).ai_draft_body).to.be.null
      })
      // Discarding is not a quiet send.
      cy.get('@send.all').should('have.length', 0)
    })
  })

  it('does not offer drafting once the 24h window has closed', () => {
    // Approving would only ever fail there, so the button that leads to it
    // should not be on screen. The receptionist is switched ON here on
    // purpose: with it off the button is hidden anyway, and the test would
    // pass without proving anything about the window.
    cy.visit('/inbox?growth=1')
    cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: true })
    seedConversation(account, 'Too Late To Draft', 'handling', { lastInboundMinutesAgo: 60 * 48 })
    cy.reload()
    cy.contains('[data-test="lead-row"]', 'Too Late To Draft').click()
    cy.get('[data-test="draft-lead-reply"]').should('not.exist')
  })

  it('offers drafting only while the receptionist is switched on', () => {
    // The switch used to record an intention and gate nothing. A control that
    // controls nothing is worse than no control: it reads as one somebody has
    // already used.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Switch Check', 'handling').then((leadId) => {
      cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: false })
      cy.reload()
      cy.contains('[data-test="lead-row"]', 'Switch Check').click()
      cy.get('[data-test="draft-lead-reply"]').should('not.exist')

      // And refused server-side too -- the button being hidden is not the
      // protection, it is the courtesy.
      cy.request({
        method: 'POST',
        url: `/api/growth/leads/${leadId}/draft-reply`,
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400)
        expect(JSON.stringify(res.body)).to.contain('switched off')
      })

      cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: true })
      cy.reload()
      cy.contains('[data-test="lead-row"]', 'Switch Check').click()
      cy.get('[data-test="draft-lead-reply"]').should('be.visible')
    })
  })

  it('does not show a message the dry run only recorded as one that was sent', () => {
    // A rule in test mode writes what it WOULD have sent as an outbound row,
    // which is the same shape as a real one. This screen is where somebody
    // decides whether the automation is working, so a message nobody received
    // must not read as one that was.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Dry Run Thread', 'handling').then((leadId) => {
      // Ordered deliberately: the dry-run row is the NEWEST, which is the
      // normal state of a lead on a rule in test mode and the case where the
      // list would otherwise claim the clinic said something it never did.
      cy.task('db:createLeadMessage', {
        accountId: account.accountId,
        leadId,
        direction: 'outbound',
        body: 'Esta sí salió.',
        status: 'delivered',
        createdAt: new Date(Date.now() - 4 * 60000).toISOString(),
      })
      cy.task('db:createLeadMessage', {
        accountId: account.accountId,
        leadId,
        direction: 'outbound',
        body: 'Bienvenida que solo se registró.',
        status: 'would_send',
        createdAt: new Date(Date.now() - 3 * 60000).toISOString(),
      })
      cy.reload()
      cy.contains('[data-test="lead-row"]', 'Dry Run Thread').click()

      cy.get('[data-test="lead-thread"]').within(() => {
        cy.contains('Test run · not sent').should('be.visible')
        cy.contains('would have been sent').should('be.visible')
        // The raw enum never reaches the screen.
        cy.contains('would_send').should('not.exist')
        // A genuinely sent message still reads as sent, in plain words.
        cy.contains('delivered').should('be.visible')
      })

      // Only the recorded one is marked; the real one keeps the normal bubble.
      cy.get('[data-test="dry-run-message"]').should('have.length', 1).and('contain', 'Bienvenida que solo se registró.')

      // And the row in the list, which is what somebody scans first. The
      // newest row on a lead in test mode is routinely a message nobody
      // received, so an unmarked preview says the clinic said it.
      cy.contains('[data-test="lead-row"]', 'Dry Run Thread').should('contain', 'Not sent ·')
    })
  })

  it('says which threads have a draft waiting, and can show only those', () => {
    // Since the tick began writing drafts unprompted, a draft can appear on a
    // thread nobody opened. Without this the drafts are found only by opening
    // conversations one at a time -- which is the work drafting was meant to
    // remove.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Draft Is Ready', 'handling').then((leadId) => {
      seedConversation(account, 'Nothing Waiting', 'handling')
      cy.task('db:setLeadDraft', { id: leadId, body: 'Te propongo el jueves a las 10:00.' })
      cy.reload()

      cy.contains('[data-test="lead-row"]', 'Draft Is Ready').find('[data-test="draft-ready-badge"]').should('be.visible')
      cy.contains('[data-test="lead-row"]', 'Nothing Waiting').find('[data-test="draft-ready-badge"]').should('not.exist')

      cy.get('[data-test="filter-draft-ready"]').should('contain', '1').click()
      cy.contains('[data-test="lead-row"]', 'Draft Is Ready').should('be.visible')
      cy.contains('[data-test="lead-row"]', 'Nothing Waiting').should('not.exist')
    })
  })

  it('hides the draft chip when nothing is waiting', () => {
    // A chip reading "· 0" every day teaches people to stop looking at it,
    // and this is the one that means somebody has work waiting.
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'No Drafts Here', 'handling')
    cy.reload()
    cy.contains('[data-test="lead-row"]', 'No Drafts Here').should('be.visible')
    cy.get('[data-test="filter-draft-ready"]').should('not.exist')
  })

  it('says why a reply failed instead of showing an empty toast', () => {
    // err.statusMessage looks like the right property and is not: ofetch maps
    // it to the response's statusText, and HTTP/2 has no reason phrases, so
    // in production it is always ''. `?? fallback` does not catch an empty
    // string, so a failed reply showed a toast with no words in it -- no
    // message, no clue, nothing to report. Locally it reads as working,
    // because the dev server is HTTP/1.1 and statusText is "Bad Request".
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Send Will Fail', 'paused').then((leadId) => {
      cy.reload()
      cy.intercept('POST', '/api/whatsapp/inbox-send', {
        statusCode: 400,
        body: { statusMessage: 'This lead has no phone number to reply to' },
      }).as('send')
      cy.contains('[data-test="lead-row"]', 'Send Will Fail').click()
      cy.get('[data-test="lead-composer"]').find('textarea').type('Hola{enter}')
      cy.wait('@send')

      // The server's words, not a blank rectangle.
      cy.contains('This lead has no phone number to reply to').should('be.visible')
      expect(leadId).to.be.a('string')
    })
  })

  it('refuses a free-text reply more than 24 hours after they last wrote', () => {
    cy.visit('/inbox?growth=1')
    // Two days since the last inbound message, which is outside WhatsApp's
    // customer-service window.
    seedConversation(account, 'Stale Thread', 'paused', { lastInboundMinutesAgo: 60 * 48 })
    cy.reload()

    cy.contains('[data-test="lead-row"]', 'Stale Thread').click()

    // Said before anyone types, not discovered on send.
    cy.get('[data-test="window-closed"]').should('be.visible')
    cy.get('[data-test="lead-composer"]').should('not.exist')
  })

  it('shows the lead rail, and says the patient record does not exist yet', () => {
    cy.viewport(1440, 900)
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Rail Check', 'paused')
    cy.reload()

    cy.contains('[data-test="lead-row"]', 'Rail Check').click()

    cy.get('[data-test="lead-rail"]').within(() => {
      cy.contains('In QuiroFlow').should('be.visible')
      cy.contains('Patient record').should('be.visible')
      cy.contains('Not created').should('be.visible')
      // A lead has no balance, so no balance row is drawn rather than 0,00 €.
      cy.contains('Balance').should('not.exist')
    })
  })

  it('filters to just what the AI is handling', () => {
    cy.visit('/inbox?growth=1')
    seedConversation(account, 'Handled By Ai', 'handling')
    seedConversation(account, 'Taken Over', 'paused')
    cy.reload()

    cy.get('[data-test="filter-ai-handling"]').click()
    cy.contains('[data-test="lead-row"]', 'Handled By Ai').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'Taken Over').should('not.exist')
  })

  // Leads sit above the patient threads in one list, which is the right
  // call -- but on a day with a lead-ad campaign running, "has a PATIENT
  // written to us" becomes a scrolling exercise. These two are the answer:
  // a badge for reading, a chip for narrowing.
  describe('telling leads and patients apart', () => {
    function seedPatientConversation(firstName: string, lastName: string, body: string) {
      return cy
        .task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
        .then((patient) => {
          cy.task('db:createWhatsappMessage', {
            accountId: account.accountId,
            patientId: (patient as { id: string }).id,
            direction: 'inbound',
            bodyPreview: body,
          })
        })
    }

    // A lead's messages live in whatsapp_messages with a phone number and no
    // patient_id, so they also grouped by phone into a second, nameless
    // "Unknown" conversation among the patient threads. Every lead appeared
    // twice. This is the half of the problem a filter cannot fix.
    it('does not also list a lead as a nameless phone-number conversation', () => {
      cy.visit('/inbox?growth=1')
      seedConversation(account, 'Nuria Lead', 'handling')
      cy.reload()

      cy.contains('[data-test="lead-row"]', 'Nuria Lead').should('be.visible')
      cy.contains('Unknown').should('not.exist')
      // The phone the lead wrote from must not open a thread of its own.
      cy.contains('+34600444901').should('not.exist')
    })

    it('badges the lead rows and leaves the patient rows alone', () => {
      cy.visit('/inbox?growth=1')
      seedConversation(account, 'Nuria Lead', 'handling')
      seedPatientConversation('Real', 'Patient', 'Necesito cambiar mi cita')
      cy.reload()

      cy.contains('[data-test="lead-row"]', 'Nuria Lead').find('[data-test="lead-badge"]').should('be.visible')
      // The badge is what makes the distinction readable without touching a
      // filter, so a patient row carrying one would be worse than no badge.
      cy.contains('Real Patient').should('be.visible')
      cy.get('[data-test="lead-row"]').should('have.length', 1)
    })

    it('narrows to one side and back', () => {
      cy.visit('/inbox?growth=1')
      seedConversation(account, 'Nuria Lead', 'handling')
      seedPatientConversation('Real', 'Patient', 'Necesito cambiar mi cita')
      cy.reload()

      cy.get('[data-test="filter-patients-only"]').click()
      cy.contains('Real Patient').should('be.visible')
      cy.get('[data-test="lead-row"]').should('not.exist')

      cy.get('[data-test="filter-leads-only"]').click()
      cy.contains('[data-test="lead-row"]', 'Nuria Lead').should('be.visible')
      cy.contains('Real Patient').should('not.exist')

      // Clicking the active chip clears it, the way every other chip here
      // behaves -- otherwise there is no way back to both without a reload.
      cy.get('[data-test="filter-leads-only"]').click()
      cy.contains('[data-test="lead-row"]', 'Nuria Lead').should('be.visible')
      cy.contains('Real Patient').should('be.visible')
    })

    it('opens a thread that the filter then hides, without closing it', () => {
      cy.visit('/inbox?growth=1')
      seedConversation(account, 'Nuria Lead', 'handling')
      cy.reload()

      cy.contains('[data-test="lead-row"]', 'Nuria Lead').click()
      cy.get('[data-test="filter-patients-only"]').click()

      // The row goes; the open conversation must not. Resolving the
      // selection against the filtered list is what emptied the panel
      // mid-reply when the AI chips were added.
      cy.get('[data-test="lead-row"]').should('not.exist')
      cy.get('[data-test="lead-thread"], [data-test="lead-thread-loading"]').should('exist')
    })

    it('offers no such chips to an account without the tier', () => {
      cy.visit('/inbox?growth=0')

      cy.get('[data-test="filter-patients-only"]').should('not.exist')
      cy.get('[data-test="filter-leads-only"]').should('not.exist')
    })
  })
})
