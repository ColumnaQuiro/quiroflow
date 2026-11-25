import { autoSaved } from '../../support/autoSave'

// An email step that carries a form: "fill in the health questionnaire before
// your first visit", sent by email to the patients a WhatsApp template never
// reaches. The step chooses the form (config.doc_template_id) and links to it
// from a button or a {{form_link}}; each patient gets their own copy, made
// only when the email really goes out.
//
// Nothing here reaches Resend: CI has no email key, so the engine half runs in
// dry run, which does everything but send -- and therefore makes no copy of
// the form either. What it pins is that the step is checked as a real one
// would be: a lead is skipped with the reason, a step with no form fails.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

interface Step {
  id: string
  action_type: string
  config: Record<string, any>
}

interface RunEvent {
  outcome: string
  step_label: string | null
  detail: string | null
}

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Email step with a form', () => {
  let account: SeededAccount
  let formId: string

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'doc_templates',
        rows: [{ account_id: account.accountId, title: 'Cuestionario de salud', fields: [{ id: 'f1', type: 'text', label: 'Motivo de consulta' }] }],
      }).then(([tpl]) => {
        formId = tpl!.id
      })
      cy.login(account.email, account.password)
    })
  })

  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const flow = (opts: Record<string, unknown>) => cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, ...opts })
  const steps = (ruleId: string) => cy.task<Step[]>('auto:actionsForRule', { ruleId })
  const runs = (ruleId: string) => cy.task<{ id: string }[]>('auto:runsForRule', { ruleId })
  const events = (runId: string) => cy.task<RunEvent[]>('db:runEvents', { runId })

  function openStep(ruleId: string) {
    steps(ruleId).then(([email]) => {
      cy.visit(`/automations/${ruleId}`)
      cy.get('[data-test="canvas-fit"]').click()
      cy.get(`[data-test="node-${email!.id}"]`).click({ force: true })
      cy.get('[data-test="email-form-select"]').should('be.visible')
    })
  }

  it('picks a form in the plain editor and adds its button, which the preview shows', () => {
    flow({
      triggerEvent: 'appointment.booked',
      enabled: false,
      steps: [{ type: 'email', config: { subject: 'Tu primera visita', body: '<p>Hola {{first_name}}, te esperamos.</p>' } }],
    }).then((rule) => {
      openStep(rule.id)
      cy.get('[data-test="email-form-select"]').select('Cuestionario de salud')
      cy.get('[data-test="email-form-button"]').should('be.checked')
      cy.get('[data-test="email-form-linked"]').should('contain', 'Cuestionario de salud')
      cy.get('[data-test="email-preview"] iframe').should('have.attr', 'srcdoc').and('contain', '/doc/ejemplo').and('contain', 'Rellenar el formulario')
      autoSaved()
      steps(rule.id).then(([email]) => {
        expect(email!.config.doc_template_id).to.eq(formId)
        expect(email!.config.form_button).to.eq(true)
      })

      // Nothing links to it any more: the step says so, before anyone is sent a form they cannot open.
      cy.get('[data-test="email-form-button"]').uncheck()
      cy.get('[data-test="email-form-unlinked"]').should('be.visible')
      cy.get('[data-test="inspector-problems"]').should('contain', 'has a form chosen but no link to it')
    })
  })

  it('adds a button to the form in an email built from blocks', () => {
    flow({
      triggerEvent: 'appointment.booked',
      enabled: false,
      steps: [
        {
          type: 'email',
          config: {
            subject: 'Tu primera visita',
            design: { version: 1, blocks: [{ id: 'b1', type: 'text', html: '<p>Hola {{first_name}}</p>' }, { id: 'b2', type: 'footer', html: '<p>Clínica</p>' }] },
          },
        },
      ],
    }).then((rule) => {
      openStep(rule.id)
      cy.get('[data-test="email-form-select"]').select('Cuestionario de salud')
      cy.get('[data-test="email-form-linked"]').should('be.visible')
      autoSaved()
      steps(rule.id).then(([email]) => {
        expect(email!.config.doc_template_id).to.eq(formId)
        const blocks = email!.config.design.blocks as { type: string; link?: { kind: string } }[]
        // Before the footer, after what the email says.
        expect(blocks.map((b) => b.type)).to.deep.eq(['text', 'button', 'footer'])
        expect(blocks[1]!.link).to.deep.eq({ kind: 'form' })
      })

      // The button's settings in the editor name the form it opens.
      cy.get('[data-test="email-edit"]').click()
      cy.get('[data-test="email-block-button"]').click()
      cy.get('[data-test="block-button-link"]').should('have.value', 'form')
      cy.get('[data-test="block-button-form-hint"]').should('contain', 'Cuestionario de salud')
    })
  })

  it('in dry run, records the email for a patient without making a copy of the form', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [{ type: 'email', config: { subject: 'Antes de tu visita', body: '<p>Rellénalo: {{form_link}}</p>', doc_template_id: formId } }],
    }).then((rule) => {
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Forma', email: `nora.${unique()}@example.test`, phone: randomPhone() }).then((p) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date().toISOString() }).then((appt) => {
          cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId: p.id, appointmentId: appt.id } })
          cy.task<{ dry_run: boolean }[]>('auto:emailsFor', { patientId: p.id }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.dry_run).to.eq(true)
          })
          // A dry run reaches nobody, so nothing is filed on their record.
          cy.task('auto:docsFor', { patientId: p.id }).should('have.length', 0)
          runs(rule.id).then(([run]) => {
            events(run!.id).then((ev) => expect(ev.map((e) => e.outcome)).to.include('dry_run'))
          })
        })
      })
    })
  })

  it('fails a step that links to a form but has none chosen', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [{ type: 'email', config: { subject: 'Antes de tu visita', body: '<p>Rellénalo: {{form_link}}</p>' } }],
    }).then((rule) => {
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Forma', email: `olga.${unique()}@example.test`, phone: randomPhone() }).then((p) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date().toISOString() }).then((appt) => {
          cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId: p.id, appointmentId: appt.id } })
          cy.task('auto:emailsFor', { patientId: p.id }).should('have.length', 0)
          runs(rule.id).then(([run]) => {
            events(run!.id).then((ev) => expect(ev.some((e) => (e.detail ?? '').includes('no form is chosen'))).to.eq(true))
          })
        })
      })
    })
  })

  it('skips a lead, who has no patient record to attach a form to, and says why', () => {
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then(({ token }) => {
      flow({
        triggerEvent: 'lead.created',
        entryMode: 'once_ever',
        steps: [{ type: 'email', config: { subject: 'Antes de tu visita', body: '<p>Rellénalo</p>', form_button: true, doc_template_id: formId } }],
      }).then((rule) => {
        cy.request({
          method: 'POST',
          url: '/api/public/v1/leads',
          headers: { Authorization: `Bearer ${token}` },
          body: { full_name: 'Lead Formulario', phone: `+34${randomPhone()}`, email: `lead.${unique()}@example.test`, external_id: `form-${unique()}` },
        })
        runs(rule.id).then(([run]) => {
          events(run!.id).then((ev) => {
            const step = ev.find((e) => (e.detail ?? '').includes('a lead has no patient record'))
            expect(step, 'the step says why').to.exist
            expect(step!.outcome).to.eq('skipped')
          })
        })
      })
    })
  })
})
