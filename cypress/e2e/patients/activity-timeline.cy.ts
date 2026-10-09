// The record's activity timeline: what happened to the patient, newest
// first, with who did it and on which channel, filterable by kind. The
// wording and ordering rules are unit-tested (patient-timeline.test.ts); this
// pins the page reading the real tables, RLS included.

describe('Patient activity timeline', () => {
  it('shows visits, messages both ways, calls, plans and exercises, newest first', () => {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    cy.seedStaffAccount().then((account) => {
      const a = account.accountId
      cy.task<{ id: string }>('db:createPatient', { accountId: a, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Prieto' }).then((patient) => {
        const p = patient.id
        cy.task('db:createAppointment', { accountId: a, clinicId: account.clinicId, patientId: p, practitionerId: account.teamMemberId, startsAt: ago(100), status: 'completed', createdAt: ago(200) })
        cy.task('db:insertRows', { table: 'contact_log', rows: [{ account_id: a, patient_id: p, action: 'called_left_message', created_by: account.teamMemberId, created_at: ago(50) }] })
        cy.task('db:insertRows', { table: 'patient_app_messages', rows: [{ account_id: a, patient_id: p, direction: 'outbound', body: 'Te esperamos el jueves', created_at: ago(20) }, { account_id: a, patient_id: p, direction: 'inbound', body: 'Perfecto, allí estaré', created_at: ago(10) }] })
        cy.task('db:createCarePlan', { accountId: a, patientId: p, totalVisits: 8, name: 'Plan dorsal' })
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: a, name: 'Gato-camello' }] }).then(([ex]) => {
          cy.task('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: a, patient_id: p, exercise_id: ex.id, assigned_by: account.teamMemberId, created_at: ago(1) }] })
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p}`)
        cy.get('[data-cy="timeline-event"]', { timeout: 20000 }).should('have.length.at.least', 7)
        cy.get('[data-cy="timeline-text"]').then((els) => {
          const texts = [...els].map((e) => e.textContent?.trim())
          // The plan was made just now, so it leads.
          expect(texts.slice(0, 4)).to.deep.equal(['Care plan "Plan dorsal" started: 8 visits, weekly', 'Home exercise assigned: Gato-camello', 'Perfecto, allí estaré', 'Te esperamos el jueves'])
          expect(texts).to.include('Called and left a voicemail')
          expect(texts).to.include('Visit attended')
        })
        // Who did it.
        cy.contains('[data-cy="timeline-event"]', 'Called and left a voicemail').find('[data-cy="timeline-actor"]').should('have.text', 'Test Owner')
        cy.contains('[data-cy="timeline-event"]', 'Perfecto, allí estaré').should('contain', 'App').find('[data-cy="timeline-actor"]').should('have.text', 'Patient')

        cy.get('[data-cy="timeline-filter-recall"]').click()
        cy.get('[data-cy="timeline-event"]').should('have.length', 1).and('contain', 'voicemail')
        cy.get('[data-cy="timeline-filter-care"]').click()
        cy.get('[data-cy="timeline-event"]').should('have.length', 2)
        cy.get('[data-cy="timeline-filter-communication"]').click()
        cy.get('[data-cy="timeline-event"]').should('have.length', 2)
      })
    })
  })
})
