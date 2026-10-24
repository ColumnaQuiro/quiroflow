// A reminder is not sent again once the patient has answered one.
//
// A clinic reminds 3 days before and again 24 hours before. A patient who
// tapped Confirmar on the first -- or asked to change the visit -- was asked
// again by the second, about a question they had already answered. Reminder
// automations now pass over an answered visit, whether the second reminder is
// its own automation or a later step of the same one; moving the visit clears
// the answer, so a visit moved to a new time is reminded of that one. An
// automation on this trigger that is not a reminder can switch it off.
//
// Only an answer to a REMINDER counts. The message sent at booking carries
// the same Confirmar button, and a patient who tapped it then, weeks before
// the visit, was never reminded at all (47 visits, 19-22 Oct 2026).
//
// Sends are asserted through dry run, as in growth-automation-engine.cy.ts.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HOUR = 3600 * 1000

describe('Reminders, once the patient has answered', () => {
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
  const cron = (path: string) => cy.request({ method: 'POST', url: `/api/automations/${path}`, headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
  const inReminderWindow = () => new Date(Date.now() + 30 * HOUR + 5 * 60 * 1000).toISOString()

  function patient(firstName: string) {
    return cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Recordatorio', phone: randomPhone() })
  }
  function appointment(patientId: string, startsAt: string, confirmationStatus?: string) {
    return cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt, confirmationStatus })
  }
  /** An earlier reminder of the visit (the 3-day one), sent before the patient answered. */
  function earlierReminder(patientId: string, appointmentId: string) {
    return cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId, appointmentId, direction: 'outbound', templateName: 'recordatorio_72h', purpose: 'reminder', createdAt: new Date(Date.now() - 2 * HOUR).toISOString() })
  }
  function reminderRule(filters: Record<string, unknown>, steps: { type: string; config: Record<string, unknown> }[] = [whatsapp('recordatorio')]) {
    return cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, triggerEvent: 'appointment.hours_before', filters, steps })
  }

  it('passes over a visit confirmed or asked to be changed after an earlier reminder, and reminds the rest', () => {
    reminderRule({ hours_before: 30 }).then(() => {
      patient('Confirmada').then((confirmed) => {
        patient('Cambiar').then((changing) => {
          patient('Pendiente').then((pending) => {
            appointment(confirmed.id, inReminderWindow()).then((appt) => {
              earlierReminder(confirmed.id, appt.id)
              cy.task('db:setConfirmationStatus', { appointmentId: appt.id, confirmationStatus: 'confirmed' })
            })
            appointment(changing.id, inReminderWindow()).then((appt) => {
              earlierReminder(changing.id, appt.id)
              cy.task('db:setConfirmationStatus', { appointmentId: appt.id, confirmationStatus: 'reschedule_requested' })
            })
            appointment(pending.id, inReminderWindow(), 'pending')
            cron('hours-before-cron')

            templates(confirmed.id).should('deep.eq', ['recordatorio_72h'])
            templates(changing.id).should('deep.eq', ['recordatorio_72h'])
            templates(pending.id).should('deep.eq', ['recordatorio'])
          })
        })
      })
    })
  })

  it('still reminds a visit confirmed when it was booked, before any reminder', () => {
    reminderRule({ hours_before: 30 }).then(() => {
      patient('Reserva').then((p) => {
        // Confirmar on the booking message: the row is created already answered.
        appointment(p.id, inReminderWindow(), 'confirmed')
        cron('hours-before-cron')
        templates(p.id).should('deep.eq', ['recordatorio'])
      })
    })
  })

  it('still sends when the automation is set to', () => {
    reminderRule({ hours_before: 30, skip_if_answered: false }).then(() => {
      patient('Formulario').then((p) => {
        appointment(p.id, inReminderWindow(), 'confirmed')
        cron('hours-before-cron')
        templates(p.id).should('deep.eq', ['recordatorio'])
      })
    })
  })

  it('reminds a confirmed visit that was then moved, of its new time', () => {
    reminderRule({ hours_before: 30 }).then(() => {
      patient('Movida').then((p) => {
        appointment(p.id, new Date(Date.now() + 96 * HOUR).toISOString(), 'confirmed').then((appt) => {
          cy.task('db:moveAppointment', { appointmentId: appt.id, startsAt: inReminderWindow() })
          cy.task<{ confirmation_status: string | null }>('db:appointmentById', { appointmentId: appt.id }).its('confirmation_status').should('eq', null)
          cron('hours-before-cron')
          templates(p.id).should('deep.eq', ['recordatorio'])
        })
      })
    })
  })

  it('stops "remind, wait, remind again" once the first was answered', () => {
    reminderRule({ hours_before: 30 }, [whatsapp('recordatorio_30h'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('recordatorio_6h')]).then((rule) => {
      patient('Respondio').then((p) => {
        appointment(p.id, inReminderWindow()).then((appt) => {
          cron('hours-before-cron')
          templates(p.id).should('deep.eq', ['recordatorio_30h'])

          // Confirmar, from the first reminder's button.
          cy.task('db:setConfirmationStatus', { appointmentId: appt.id, confirmationStatus: 'confirmed' })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          cron('lead-sequence-cron')

          templates(p.id).should('deep.eq', ['recordatorio_30h'])
          cy.task<{ status: string; stopped_reason: string | null }[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
            expect(runs).to.have.length(1)
            expect(runs[0]!.status).to.eq('cancelled')
            expect(runs[0]!.stopped_reason).to.eq('appointment_answered')
          })
        })
      })
    })
  })
})
