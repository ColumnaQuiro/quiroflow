// "Referred patient completes a visit" (referral.visit_completed): when a
// patient someone referred has a visit completed, the rule's message goes to
// the patient who referred them, not to the one who came. Every visit fires
// it; the rule's own filters (Completed visits, Appointment type) say which,
// and they are read on the referred patient and their visit.
//
// Raised beside appointment.completed, so the spec fires that event the way
// the calendar does, and asserts through dry-run email rows: their subject is
// the merged one, which is where {{referred_first_name}} shows.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface EmailRow {
  dry_run: boolean
  rule_id: string | null
  recipient_email: string
  subject: string | null
}

const unique = () => `${Date.now()}.${Math.floor(Math.random() * 1e6)}`
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

describe('Thanking whoever referred a patient, after a visit of theirs', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  const thanks = { type: 'email', config: { subject: 'Gracias por traer a {{referred_first_name}}, {{first_name}}', body: '<p>Gracias</p>' } }

  function rule(filters: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Gracias por recomendarnos',
      triggerEvent: 'referral.visit_completed',
      dryRun: true,
      filters,
      actions: [thanks],
    })
  }

  function patient(firstName: string, referredByPatientId?: string) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName,
      lastName: 'Prueba',
      email: `${firstName.toLowerCase()}.${unique()}@example.test`,
      ...(referredByPatientId ? { referredByPatientId } : {}),
    })
  }

  function completedVisit(patientId: string, days: number, extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('db:createAppointment', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      patientId,
      startsAt: daysAgo(days),
      status: 'completed',
      ...extra,
    })
  }

  const complete = (patientId: string, appointmentId: string) =>
    cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId, appointmentId } })

  it("emails the patient who referred them, named, once the referred patient's first visit is completed", () => {
    rule({ total_visits: 1 }).then((r) => {
      patient('Carmen').then((referrer) => {
        patient('Marta', referrer.id).then((referred) => {
          completedVisit(referred.id, 0).then((visit) => {
            complete(referred.id, visit.id)
            cy.task<EmailRow[]>('auto:emailsFor', { patientId: referrer.id }).then((rows) => {
              expect(rows).to.have.length(1)
              expect(rows[0]!.subject).to.eq('Gracias por traer a Marta, Carmen')
              expect(rows[0]!.rule_id).to.eq(r.id)
              expect(rows[0]!.dry_run).to.eq(true)
            })
            // The one who came gets nothing from it.
            cy.task('auto:emailsFor', { patientId: referred.id }).should('have.length', 0)
            // Completing the same visit again (reopened, completed) thanks nobody twice.
            complete(referred.id, visit.id)
            cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 1)
          })
        })
      })
    })
  })

  it('fires on whichever visit the filters name: the second, not the first', () => {
    rule({ total_visits: 2 })
    patient('Carmen').then((referrer) => {
      patient('Marta', referrer.id).then((referred) => {
        completedVisit(referred.id, 7).then((first) => {
          complete(referred.id, first.id)
          cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 0)
          completedVisit(referred.id, 0).then((second) => {
            complete(referred.id, second.id)
            cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 1)
          })
        })
      })
    })
  })

  it("reads an appointment-type filter on the referred patient's visit", () => {
    cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: `Primera visita ${unique()}` }).then((firstVisitType) => {
      rule({ appointment_type_ids: [firstVisitType.id] })
      patient('Carmen').then((referrer) => {
        patient('Marta', referrer.id).then((referred) => {
          completedVisit(referred.id, 7).then((other) => {
            complete(referred.id, other.id)
            cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 0)
          })
          completedVisit(referred.id, 0, { appointmentTypeId: firstVisitType.id }).then((visit) => {
            complete(referred.id, visit.id)
            cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 1)
          })
        })
      })
    })
  })

  it('does nothing for a patient nobody referred, and leaves "Appointment completed" rules as they were', () => {
    rule()
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Tras la cita',
      triggerEvent: 'appointment.completed',
      dryRun: true,
      actions: [{ type: 'email', config: { subject: 'Gracias {{first_name}}', body: '<p>Hola</p>' } }],
    })
    patient('Lola').then((p) => {
      completedVisit(p.id, 0).then((visit) => {
        complete(p.id, visit.id).its('body').should('deep.eq', { fired: 1 })
        cy.task<EmailRow[]>('auto:emailsFor', { patientId: p.id }).then((rows) => {
          expect(rows.map((r) => r.subject)).to.deep.eq(['Gracias Lola'])
        })
      })
    })
  })

  it('waits for the visit to be completed: a booked one thanks nobody', () => {
    rule()
    patient('Carmen').then((referrer) => {
      patient('Marta', referrer.id).then((referred) => {
        completedVisit(referred.id, -2, { status: 'booked' }).then((visit) => {
          complete(referred.id, visit.id)
          cy.task('auto:emailsFor', { patientId: referrer.id }).should('have.length', 0)
        })
      })
    })
  })
})
