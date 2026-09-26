// Test mode means nothing leaves the building -- on every channel.
//
// A rule's dry_run flag was only ever passed to the WhatsApp step. An email
// step in a test-mode rule went out through Resend, and a webhook step was
// called for real, so the one setting that exists to make switching on a
// lead drip safe was safe for one channel out of three.
//
// Driven through lead ingest, which runs a lead.created rule's first steps in
// the same request -- the path a real welcome drip takes.

interface SeededAccount {
  email: string
  password: string
  accountId: string
}

interface EmailRow {
  provider_message_id: string | null
  dry_run: boolean
  rule_id: string | null
  recipient_email: string
  subject: string | null
}

describe('Automation test mode', () => {
  let account: SeededAccount
  let token: string
  let hookUrl: string

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
        token = t.token
      })
    })
    cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
      hookUrl = url
    })
  })

  afterEach(() => {
    cy.task('db:stopWebhookReceiver')
  })

  function ingest(body: Record<string, unknown>) {
    return cy.request({
      method: 'POST',
      url: '/api/public/v1/leads',
      headers: { Authorization: `Bearer ${token}` },
      body: { marketing_consent: true, ...body },
    })
  }

  function emailAndWebhookRule(dryRun: boolean) {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      isMarketing: true,
      dryRun,
      // Webhook first: a live run has no Resend key in CI, so its email step
      // fails, and a failed step holds the drip for a retry -- a webhook after
      // it would never be reached, and the live test would prove nothing.
      actions: [
        { type: 'webhook', config: { url: hookUrl } },
        { type: 'email', config: { subject: 'Hola {{first_name}}', body: '<p>Bienvenida, {{first_name}}.</p>' } },
      ],
    })
  }

  it('records the email it would have sent, and does not send it', () => {
    emailAndWebhookRule(true).then((rule) => {
      ingest({ full_name: 'Lucia Prueba', email: 'lucia.dryrun@example.com', external_id: 'dry-email' }).then((res) => {
        cy.task<EmailRow[]>('db:leadEmailMessages', { leadId: res.body.data.id }).then((rows) => {
          expect(rows).to.have.length(1)
          // Merged, addressed and attributed like a real send...
          expect(rows[0]!.subject).to.eq('Hola Lucia')
          expect(rows[0]!.recipient_email).to.eq('lucia.dryrun@example.com')
          expect(rows[0]!.rule_id).to.eq(rule.id)
          // ...but marked as never having reached the provider.
          expect(rows[0]!.dry_run).to.eq(true)
          expect(rows[0]!.provider_message_id).to.be.null
        })
      })
    })
  })

  it('does not call the webhook', () => {
    emailAndWebhookRule(true)
    ingest({ full_name: 'Hook Prueba', email: 'hook.dryrun@example.com', external_id: 'dry-hook' }).then(() => {
      cy.task<string[]>('db:webhookReceiverHits').should('have.length', 0)
    })
  })

  it('calls the webhook and records no test email when the rule is live', () => {
    // The other half, so the zero above is a zero from test mode and not from
    // a receiver nothing could have reached.
    emailAndWebhookRule(false)
    ingest({ full_name: 'Live Rule', email: 'live.rule@example.com', external_id: 'live-hook' }).then((res) => {
      cy.task<string[]>('db:webhookReceiverHits').should('have.length', 1)
      cy.task<EmailRow[]>('db:leadEmailMessages', { leadId: res.body.data.id }).then((rows) => {
        expect(rows.filter((r) => r.dry_run)).to.have.length(0)
      })
    })
  })

  // A Meta lead ad's questions arrive as answers on the lead; each one is a
  // variable of its own, named after the question, so a welcome message can
  // say what they came in for.
  it('fills a variable with what the lead answered on the form', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      isMarketing: true,
      dryRun: true,
      actions: [
        {
          type: 'email',
          config: {
            subject: '{{first_name}}, sobre {{answer_cual_seria_el_motivo_de_tu_consulta}} ({{answer_presupuesto}})',
            body: '<p>Hola {{first_name}}.</p>',
          },
        },
      ],
    })
    ingest({
      full_name: 'Marta Formulario',
      email: 'marta.form@example.com',
      external_id: 'form-answers',
      // Meta's field_data keys, passed straight through as n8n does.
      answers: { 'cuál_sería_el_motivo_de_tu_consulta?': 'Dolor de espalda' },
    }).then((res) => {
      cy.task<EmailRow[]>('db:leadEmailMessages', { leadId: res.body.data.id }).then((rows) => {
        expect(rows).to.have.length(1)
        // A question this lead was not asked merges as nothing, not as the token.
        expect(rows[0]!.subject).to.eq('Marta, sobre Dolor de espalda ()')
      })
    })
  })
})
