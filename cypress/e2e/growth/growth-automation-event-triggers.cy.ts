// Four triggers raised where their event already happens, not by the
// calendar: a satisfaction answer, a tag added or removed, a form completed,
// a lead moved to a stage. Each rule is in test mode with one email step, so
// a start is visible as the email it records -- and its absence as none.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface EmailRow {
  dry_run: boolean
  rule_id: string | null
  subject: string | null
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Automations started by events', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  function patient() {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Ana',
      lastName: 'Prueba',
      email: `ana.${stamp()}@example.test`,
      phone: randomPhone(),
    })
  }

  function rule(triggerEvent: string, filters: Record<string, unknown>, subject: string) {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent,
      dryRun: true,
      filters,
      actions: [{ type: 'email', config: { subject, body: '<p>Hola {{first_name}}</p>' } }],
    })
  }

  const emailsFor = (patientId: string) => cy.task<EmailRow[]>('auto:emailsFor', { patientId })

  it('starts on the tag it names, added or removed, and not on another', () => {
    rule('patient.tag_added', { trigger_tag: 'Embarazada' }, 'Etiqueta puesta')
    rule('patient.tag_removed', { trigger_tag: 'embarazada' }, 'Etiqueta quitada')
    patient().then((p) => {
      cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'patient.tag_added', patientId: p.id, tag: 'deportista' } })
      cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'patient.tag_added', patientId: p.id, tag: 'embarazada' } })
      cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'patient.tag_removed', patientId: p.id, tag: 'EMBARAZADA' } })
      emailsFor(p.id).should((rows) => {
        expect(rows.map((r) => r.subject)).to.deep.eq(['Etiqueta puesta', 'Etiqueta quitada'])
        expect(rows.every((r) => r.dry_run)).to.eq(true)
      })
    })
  })

  it('starts on a satisfaction answer in its band, once, from the patient\'s own link', () => {
    rule('satisfaction.answered', { trigger_score: 'low' }, 'Nota baja')
    rule('satisfaction.answered', { trigger_score: 'high' }, 'Nota alta')
    patient().then((p) => {
      cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }).then((appt) => {
        const token = `t${stamp()}`
        cy.task('db:insertRows', { table: 'satisfaction_surveys', rows: [{ account_id: account.accountId, appointment_id: appt.id, token }] })
        // No login: the patient answers from the link.
        cy.clearCookies()
        cy.request({ method: 'POST', url: `/api/satisfaction/${token}`, body: { score: 2 } })
        // Changing it afterwards is a correction, not a second answer.
        cy.request({ method: 'POST', url: `/api/satisfaction/${token}`, body: { score: 5 } })
        emailsFor(p.id).should((rows) => {
          expect(rows.map((r) => r.subject)).to.deep.eq(['Nota baja'])
        })
      })
    })
  })

  it('starts on a form completed since it was switched on, once however many ticks see it', () => {
    rule('doc.completed', {}, 'Formulario recibido')
    patient().then((p) => {
      cy.task('db:insertRows', { table: 'patient_docs', rows: [{ account_id: account.accountId, patient_id: p.id, title: 'Anamnesis', completed_at: new Date().toISOString() }] })
      const tick = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      tick()
      tick()
      emailsFor(p.id).should((rows) => {
        expect(rows.map((r) => r.subject)).to.deep.eq(['Formulario recibido'])
      })
    })
  })

  it('starts when the team moves a lead to the stage it names', () => {
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then(({ token }) => {
      rule('lead.stage_changed', { trigger_lead_stage: 'qualified' }, 'Cuéntanos más')
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${token}` },
        body: { full_name: 'Lead Prueba', email: `lead.${stamp()}@example.test`, marketing_consent: true, external_id: `stage-${stamp()}` },
      }).then((res) => {
        const leadId = res.body.data.id as string
        cy.request({ method: 'PATCH', url: `/api/growth/leads/${leadId}`, body: { stage: 'contacted' } })
        cy.task<EmailRow[]>('db:leadEmailMessages', { leadId }).should('have.length', 0)
        cy.request({ method: 'PATCH', url: `/api/growth/leads/${leadId}`, body: { stage: 'qualified' } })
        cy.task<EmailRow[]>('db:leadEmailMessages', { leadId }).should((rows) => {
          expect(rows.map((r) => r.subject)).to.deep.eq(['Cuéntanos más'])
        })
      })
    })
  })
})
