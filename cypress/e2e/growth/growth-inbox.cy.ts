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
    .task('db:createLead', { accountId: account.accountId, fullName: name, stage: 'contacted', phone: '+34622471903', source: 'Meta Ads · Back pain' })
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
      // A lead has no balance, so no balance row is drawn rather than €0.00.
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
})
