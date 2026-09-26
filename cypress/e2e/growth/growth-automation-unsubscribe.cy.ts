// Unsubscribing from a clinic's marketing email: the signed link in the
// footer of every email a marketing rule sends, the page it opens, and the
// one-click endpoint behind the List-Unsubscribe header. No login anywhere --
// the recipient is a patient or a lead, not staff.
//
// What goes INTO the email (the footer for marketing rules only, the headers)
// is pinned by tests/unit/automations-phase3.test.ts; an e2e run has no Resend
// key, so nothing is actually sent. The token here is minted with the same
// function and the same secret the server uses.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Unsubscribe from marketing email', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount({ clinicName: 'Clínica Baja' }).then((seeded) => {
      account = seeded as unknown as SeededAccount
    })
  })

  function patient(marketingChannels: string[]) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Nuria',
      lastName: 'Baja',
      email: `nuria.${Date.now()}@example.test`,
      marketingChannels,
    })
  }

  const token = (kind: 'patient' | 'lead', id: string) => cy.task<string>('auto:unsubscribeToken', { kind, id })
  const channels = (patientId: string) => cy.task<string[]>('auto:patientChannels', { patientId })
  const info = (t: string, failOnStatusCode = true) =>
    cy.request({ url: `/api/unsubscribe/${t}`, headers: { accept: 'application/json' }, failOnStatusCode })
  const post = (t: string, failOnStatusCode = true) => cy.request({ method: 'POST', url: `/api/unsubscribe/${t}`, failOnStatusCode })

  const inSpanish = { onBeforeLoad: (win: Window) => Object.defineProperty(win.navigator, 'languages', { value: ['es-ES', 'es'] }) }
  const inEnglish = { onBeforeLoad: (win: Window) => Object.defineProperty(win.navigator, 'languages', { value: ['en-GB', 'en'] }) }

  it('asks first, then takes email off -- and only email -- with no login', () => {
    patient(['whatsapp', 'email']).then((p) => {
      token('patient', p.id).then((t) => {
        info(t).its('body').should('deep.eq', { clinicName: 'Clínica Baja', unsubscribed: false })

        cy.visit(`/unsubscribe/${t}`, inSpanish)
        cy.contains('h1', '¿Darte de baja?').should('be.visible')
        cy.get('[data-cy="unsubscribe-card"]').should('contain.text', 'Clínica Baja')
        // Opening the page changed nothing: a link-scanning mail filter opens
        // every link, and must not unsubscribe anybody by doing so.
        channels(p.id).should('deep.eq', ['whatsapp', 'email'])

        cy.get('[data-cy="unsubscribe-confirm"]').click()
        cy.get('[data-cy="unsubscribe-done"]').should('have.text', 'Te has dado de baja')
        channels(p.id).should('deep.eq', ['whatsapp'])

        // Idempotent: again, from the page or the endpoint, changes nothing and does not fail.
        cy.visit(`/unsubscribe/${t}`, inSpanish)
        cy.get('[data-cy="unsubscribe-done"]').should('have.text', 'Ya estabas dado de baja')
        post(t).its('body').should('deep.include', { unsubscribed: true, alreadyUnsubscribed: true })
        channels(p.id).should('deep.eq', ['whatsapp'])
      })
    })
  })

  it('speaks English to a browser that prefers it', () => {
    patient(['email']).then((p) => {
      token('patient', p.id).then((t) => {
        cy.visit(`/unsubscribe/${t}`, inEnglish)
        cy.contains('h1', 'Unsubscribe?').should('be.visible')
        cy.get('[data-cy="unsubscribe-confirm"]').should('contain.text', 'Unsubscribe me').click()
        cy.get('[data-cy="unsubscribe-done"]').should('have.text', 'You have unsubscribed')
        channels(p.id).should('deep.eq', [])
      })
    })
  })

  it('takes a one-click unsubscribe from a mail client (RFC 8058)', () => {
    patient(['email', 'whatsapp']).then((p) => {
      token('patient', p.id).then((t) => {
        cy.request({
          method: 'POST',
          url: `/api/unsubscribe/${t}`,
          form: true,
          body: { 'List-Unsubscribe': 'One-Click' },
        }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body).to.deep.include({ unsubscribed: true, alreadyUnsubscribed: false })
        })
        channels(p.id).should('deep.eq', ['whatsapp'])
      })
    })
  })

  it('sends a browser that opens the one-click address to the page, which still asks', () => {
    patient(['email']).then((p) => {
      token('patient', p.id).then((t) => {
        cy.request({ url: `/api/unsubscribe/${t}`, headers: { accept: 'text/html' }, followRedirect: false }).then((res) => {
          expect(res.status).to.eq(302)
          expect(res.redirectedToUrl).to.match(new RegExp(`/unsubscribe/${t.replace(/\./g, '\\.')}$`))
        })
        channels(p.id).should('deep.eq', ['email'])
      })
    })
  })

  it('refuses a forged token, and one edited to point at another patient', () => {
    patient(['email']).then((victim) => {
      patient(['email']).then((holder) => {
        token('patient', holder.id).then((t) => {
          const edited = t.replace(holder.id, victim.id)
          info(edited, false).its('status').should('eq', 404)
          post(edited, false).its('status').should('eq', 404)
          const forged = `p.${victim.id}.${'A'.repeat(32)}`
          post(forged, false).its('status').should('eq', 404)
          post('nonsense', false).its('status').should('eq', 404)
          channels(victim.id).should('deep.eq', ['email'])
          channels(holder.id).should('deep.eq', ['email'])

          cy.visit(`/unsubscribe/${edited}`, inSpanish)
          cy.get('[data-cy="unsubscribe-invalid"]').should('contain.text', 'no es válido')
          cy.get('[data-cy="unsubscribe-confirm"]').should('not.exist')
        })
      })
    })
  })

  it('clears a lead’s marketing consent, and notes it on their timeline', () => {
    cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Lead Baja', email: 'lead.baja@example.test' }).then((lead) => {
      cy.task('auto:setLeadConsent', { leadId: lead.id, consentedAt: new Date().toISOString() })
      token('lead', lead.id).then((t) => {
        info(t).its('body.unsubscribed').should('eq', false)
        post(t).its('body.alreadyUnsubscribed').should('eq', false)
        cy.task('auto:leadConsent', { leadId: lead.id }).should('deep.eq', { marketing_consent_at: null, marketing_consent_source: null })
        cy.task<{ kind: string; title: string }[]>('db:leadEvents', { leadId: lead.id }).then((events) => {
          expect(events.map((e) => e.title)).to.include('Unsubscribed from marketing')
        })
        post(t).its('body.alreadyUnsubscribed').should('eq', true)
        // A patient's token is not a lead's, even with the same id.
        token('patient', lead.id).then((pt) => info(pt, false).its('status').should('eq', 404))
      })
    })
  })
})
