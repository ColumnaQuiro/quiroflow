import { todayAt } from '../../support/calendar'

// Pain 0-10 visit by visit (visit_pain_scores): tapped by the practitioner
// beside the note on My Day, given by the patient right after "Ya estoy aquí",
// and read back on the record's Progress tab as a curve, a table and the
// re-exam PDF. The practitioner's score counts over the patient's.
const daysAgo = (d: number) => {
  const at = new Date(todayAt(10, 0))
  at.setDate(at.getDate() - d)
  return at.toISOString()
}
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

describe('Progress tracking', () => {
  it('scores pain on My Day and shows the curve and the report on the record', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Campos' }).then((patient) => {
        const past = (d: number, score: Record<string, number>) =>
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(d), status: 'completed' }).then((a) => {
            cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: a.id, ...score }] })
          })
        // The first only scored by the patient; the second by both, where the practitioner's counts.
        past(14, { patient_score: 7 })
        past(7, { patient_score: 6, practitioner_score: 5 })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) }).then((today) => {
          cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: today.id, patient_score: 4 }] })
          cy.intercept({ url: '**/rest/v1/visit_pain_scores*', method: 'POST' }).as('painSave')

          cy.login(account.email, account.password)
          cy.visit('/practitioner')
          cy.contains('li:not([data-cy=needs-confirming-row])', 'Irene Campos', { timeout: 20000 }).click()
          cy.get('[data-cy=pain-score-patient]').should('contain', '4')
          cy.get('[data-cy=pain-score-3]').click()
          cy.get('[data-cy=pain-score-3]').should('have.attr', 'aria-checked', 'true')
          cy.wait('@painSave')
          cy.task<{ practitioner_score: number; patient_score: number }[]>('db:selectRows', { table: 'visit_pain_scores', columns: 'practitioner_score, patient_score', match: { appointment_id: today.id } })
            .its('0').should('deep.include', { practitioner_score: 3, patient_score: 4 })

          cy.visit(`/patients/${patient.id}?tab=progress`)
          cy.get('[data-cy=progress-tab][data-ready=true]', { timeout: 20000 })
          cy.get('[data-cy=progress-latest]').should('contain', '3')
          cy.get('[data-cy=progress-change]').should('contain', '-4')
          cy.get('[data-cy=progress-row]').should('have.length', 3)
          cy.get('[data-cy=progress-row]').eq(1).should('contain', '5')
          cy.get('[data-cy=progress-row]').eq(2).should('contain', 'Patient, on arrival')

          cy.clickUntil('[data-cy=progress-report]', '[data-cy=progress-report][data-pdf-result]:not([data-pdf-result=""])')
          cy.get('[data-cy=progress-report]')
            .invoke('attr', 'data-pdf-result')
            .then((raw) => {
              const result = JSON.parse(raw!)
              expect(result.blocks.map((b: { kind: string }) => b.kind)).to.deep.eq(['kpis', 'image', 'table'])
            })
        })
      })
    })
  })

  it('asks the patient for their pain after they check in', () => {
    const email = `pain-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teo', lastName: 'Duele' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(7), status: 'completed' }).then((before) => {
          cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: before.id, practitioner_score: 6 }] })
        })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(20) }).then((appt) => {
          cy.login(email, password)
          cy.visit('/portal')
          cy.get('[data-cy=patient-check-in]').click()
          cy.get('[data-cy=pain-ask]').should('be.visible')
          cy.get('[data-cy=pain-ask-before]').should('contain', 'Last time you gave 6')
          cy.get('[data-cy=pain-ask-4]').click()
          cy.get('[data-cy=pain-ask-save]').click()
          cy.get('[data-cy=pain-ask-saved]').should('be.visible')
          cy.task<{ patient_score: number; practitioner_score: number | null }[]>('db:selectRows', { table: 'visit_pain_scores', columns: 'patient_score, practitioner_score', match: { appointment_id: appt.id } })
            .its('0').should('deep.equal', { patient_score: 4, practitioner_score: null })
          // Answered, it does not ask again.
          cy.reload()
          cy.get('[data-cy=patient-checked-in]').should('be.visible')
          cy.get('[data-cy=pain-ask]').should('not.exist')
        })
      })
    })
  })

  it('refuses a score for someone else, or for a visit days away', () => {
    const email = `pain-guard-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Ajena' }).then((other) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: other.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(10) }).then((theirs) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Propia' }).then((patient) => {
            cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
            cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(3 * 24 * 60) }).then((later) => {
              cy.task<{ data: boolean | null }>('db:callRpcAs', { email, password, fn: 'set_my_pain_score', args: { p_appointment_id: theirs.id, p_score: 5 } }).its('data').should('eq', false)
              cy.task<{ data: boolean | null }>('db:callRpcAs', { email, password, fn: 'set_my_pain_score', args: { p_appointment_id: later.id, p_score: 5 } }).its('data').should('eq', false)
              cy.task<unknown[]>('db:selectRows', { table: 'visit_pain_scores', columns: 'id', match: { appointment_id: theirs.id } }).should('have.length', 0)
            })
          })
        })
      })
    })
  })
})
