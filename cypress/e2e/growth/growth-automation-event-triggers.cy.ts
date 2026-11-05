// Triggers raised where their event already happens, not by the calendar: a
// satisfaction answer, a tag added or removed, a form completed, a care plan
// milestone, a bono running low, a lead moved to a stage. Each rule is in test mode with one email step, so
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

  const tick = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('starts after the visit before a re-exam on the care plan, once', () => {
    rule('care_plan.milestone', {}, 'Toca revisión')
    patient().then((p) => {
      const today = new Date().toISOString().slice(0, 10)
      cy.task('db:insertRows', { table: 'care_plans', rows: [{ account_id: account.accountId, patient_id: p.id, total_visits: 12, started_at: today, visit_markers: [{ at: 3 }] }] })
      // Visit 1 and visit 2 of the plan, today; a cancelled one between them does not count.
      const visit = (startsAt: string, status: string) => cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt, status })
      visit(ago(40 * 1000), 'completed')
      visit(ago(30 * 1000), 'cancelled')
      visit(ago(20 * 1000), 'completed').then(() => {
        tick()
        tick()
        // Visit 1 is not before a re-exam; visit 2 is (visit 3 is marked).
        emailsFor(p.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Toca revisión']))
      })
    })
  })

  it('starts when a session leaves a bono with one left, once per bono', () => {
    rule('bono.running_low', { trigger_sessions_left: 1 }, 'Te queda una sesión')
    patient().then((p) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'package_purchases', rows: [{ account_id: account.accountId, patient_id: p.id, package_name: 'Bono 5', sessions_total: 5, sessions_used: 4, price_cents: 20000 }] }).then((rows) => {
        const purchaseId = (rows as unknown as { id: string }[])[0]!.id
        cy.task('db:insertRows', { table: 'package_sessions', rows: [{ account_id: account.accountId, patient_id: p.id, package_purchase_id: purchaseId, amount_cents: 4000, used_at: new Date().toISOString() }] })
        tick()
        tick()
        emailsFor(p.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Te queda una sesión']))
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
