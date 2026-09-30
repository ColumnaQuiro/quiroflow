// A run started by an appointment stops when that appointment goes away.
//
// "Eliminar cita" sets deleted_at and leaves status 'booked'. The crons that
// START a rule already skip a deleted appointment, but a run that had
// already started -- parked at a delay, a wait or quiet hours -- kept its
// appointment_id and walked on at the next tick, sending the rest of its
// steps about a visit that no longer exists. A reminder rule's run ("30 hours
// before: remind; 24 hours later: remind again") did the same for a visit
// that had been cancelled in between.
//
// Sends are asserted through dry run, as in growth-automation-engine.cy.ts.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface Run {
  id: string
  status: string
  stopped_reason: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HOUR = 3600 * 1000

describe('Automation runs of a deleted or cancelled appointment', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const whatsapp = (template: string) => ({ type: 'whatsapp_template', config: { template_name: template, template_language: 'es' } })
  const templates = (patientId: string) => cy.task<{ template_name: string }[]>('auto:whatsappFor', { patientId }).then((rows) => rows.map((r) => r.template_name))
  const runs = (ruleId: string) => cy.task<Run[]>('auto:runsForRule', { ruleId })

  function tick() {
    return cy
      .request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      .its('status')
      .should('eq', 200)
  }

  function patient() {
    return cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Borrada', phone: randomPhone() })
  }

  function appointment(patientId: string, startsAt: string) {
    return cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt })
  }

  it('stops a parked run when its appointment is deleted, and sends nothing more about it', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.booked',
      steps: [whatsapp('reservada'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('prepara_tu_visita')],
    }).then((rule) => {
      patient().then((p) => {
        appointment(p.id, new Date(Date.now() + 72 * HOUR).toISOString()).then((appt) => {
          cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id } })
          templates(p.id).should('deep.eq', ['reservada'])
          runs(rule.id).its(0).its('status').should('eq', 'running')

          // Eliminar cita, as the calendar does it.
          cy.task('db:writeAsStaff', { email: account.email, password: account.password, op: 'softDeleteAppointment', appointmentId: appt.id }).its('rows').should('eq', 1)
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()

          templates(p.id).should('deep.eq', ['reservada'])
          runs(rule.id).then((rs) => {
            expect(rs).to.have.length(1)
            expect(rs[0]!.status).to.eq('cancelled')
            expect(rs[0]!.stopped_reason).to.eq('appointment_deleted')
          })
        })
      })
    })
  })

  it('stops a reminder run whose appointment was cancelled before the second reminder', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.hours_before',
      filters: { hours_before: 30 },
      steps: [whatsapp('recordatorio_30h'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('recordatorio_6h')],
    }).then((rule) => {
      patient().then((p) => {
        appointment(p.id, new Date(Date.now() + 30 * HOUR + 5 * 60 * 1000).toISOString()).then((appt) => {
          cy.request({ method: 'POST', url: '/api/automations/hours-before-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
          templates(p.id).should('deep.eq', ['recordatorio_30h'])

          cy.task('db:setAppointmentStatus', { appointmentId: appt.id, status: 'cancelled' })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()

          templates(p.id).should('deep.eq', ['recordatorio_30h'])
          runs(rule.id).then((rs) => {
            expect(rs).to.have.length(1)
            expect(rs[0]!.status).to.eq('cancelled')
            expect(rs[0]!.stopped_reason).to.eq('appointment_cancelled')
          })
        })
      })
    })
  })

  it('carries on when the appointment is still there', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.booked',
      steps: [whatsapp('reservada'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('prepara_tu_visita')],
    }).then((rule) => {
      patient().then((p) => {
        appointment(p.id, new Date(Date.now() + 72 * HOUR).toISOString()).then((appt) => {
          cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id } })
          templates(p.id).should('deep.eq', ['reservada'])
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          templates(p.id).should('deep.eq', ['reservada', 'prepara_tu_visita'])
          runs(rule.id).its(0).its('status').should('eq', 'done')
        })
      })
    })
  })
})
