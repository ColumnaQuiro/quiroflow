// Leads move through the pipeline from what happens in the calendar
// (the leads_follow_appointments trigger), and carry the account's default
// value when they have none of their own (Settings → Leads).
//
// Appointments are written straight to the database here, as the calendar's
// own client writes them -- which is the point: the move has to happen
// whichever of the five booking routes made the appointment, so it cannot
// depend on an API endpoint these tests would otherwise call.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface LeadRow {
  stage: string
  patient_id: string | null
  converted_at: string | null
}

describe('Lead stages follow the calendar', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
    })
  })

  const lead = (id: string) => cy.task<LeadRow>('db:leadById', { id })

  function book(patientId: string, extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('db:createAppointment', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      patientId,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      ...extra,
    })
  }

  it('books, shows and converts a Meta lead booked at the desk', () => {
    cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste' }).then((ajuste) => {
      cy.task('db:setLeadPipelineSettings', { accountId: account.accountId, convertAfterVisits: 2, convertAppointmentTypeId: ajuste.id })
      // As Meta sends it: country code, no spaces. The desk types it the way
      // the patient says it.
      cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Ana Formulario', channel: 'facebook', phone: '34612398765', estimatedValueCents: null }).then(({ id: leadId }) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', phone: '612 39 87 65' }).then((patient) => {
          book(patient.id).then((first) => {
            lead(leadId).its('stage').should('eq', 'booked')
            lead(leadId).its('patient_id').should('eq', patient.id)

            cy.task('db:checkInAppointment', { appointmentId: first.id })
            lead(leadId).its('stage').should('eq', 'showed')
            // Attended, but not the type the rule counts.
            lead(leadId).its('converted_at').should('be.null')

            book(patient.id, { appointmentTypeId: ajuste.id, status: 'completed' })
            lead(leadId).its('stage').should('eq', 'showed')
            book(patient.id, { appointmentTypeId: ajuste.id }).then((second) => {
              cy.task('db:checkInAppointment', { appointmentId: second.id })
              lead(leadId).then((row) => {
                expect(row.stage).to.eq('converted')
                expect(row.converted_at).to.be.a('string')
              })
            })

            cy.task<{ title: string; detail: string }[]>('db:leadEvents', { leadId }).then((events) => {
              const moves = events.filter((e) => e.title.startsWith('Moved to')).map((e) => e.title)
              expect(moves).to.deep.eq(['Moved to Booked', 'Moved to Showed', 'Moved to Converted'])
            })
          })
        })
      })
    })
  })

  it('never moves a lead out of Lost, or on a visit from before it came in', () => {
    cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Perdida', email: 'perdida@example.com', stage: 'lost' }).then(({ id: lostId }) => {
      cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Antigua', email: 'antigua@example.com' }).then(({ id: oldId }) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Perdida', email: 'perdida@example.com' }).then((p) => {
          book(p.id, { status: 'completed' })
          lead(lostId).its('stage').should('eq', 'lost')
        })
        // A patient of years who fills in an ad form today: last year's visit
        // is not them turning up because of it.
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Antigua', email: 'antigua@example.com' }).then((p) => {
          book(p.id, { startsAt: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(), status: 'completed' })
          lead(oldId).its('stage').should('eq', 'new')
        })
      })
    })
  })

  it('values a lead with no figure of its own at the account default', () => {
    cy.task('db:setLeadPipelineSettings', { accountId: account.accountId, defaultValueCents: 35_000 })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Sin Valor', stage: 'contacted', estimatedValueCents: null })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Con Valor', stage: 'contacted', estimatedValueCents: 10_000 })
    cy.login(account.email, account.password)
    cy.visit('/growth/leads?growth=1')
    // 350 € default + 100 € of its own.
    cy.get('[data-test="lead-column-contacted"]').should('contain', '450 € est.')
  })
})
