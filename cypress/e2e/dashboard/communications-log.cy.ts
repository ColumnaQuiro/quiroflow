// Reports > Communications: every outbound message on every channel in one
// list (communications_log). Inbound messages and dry runs are not "sent",
// so they stay out; a push to a patient is now recorded (patient_push_log)
// and shows beside the rest.

describe('Communications log', () => {
  it('lists what was sent on every channel, and filters it', () => {
    const now = Date.now()
    const ago = (min: number) => new Date(now - min * 60_000).toISOString()
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Navarro' }).then((patient) => {
        const a = account.accountId
        const p = patient.id
        cy.task('db:insertRows', {
          table: 'whatsapp_messages',
          rows: [
            { account_id: a, patient_id: p, direction: 'outbound', purpose: 'reminder', status: 'read', phone_number: '+34600111222', body_preview: 'Recuerda tu cita de mañana a las 10:00', created_at: ago(50) },
            { account_id: a, patient_id: p, direction: 'outbound', purpose: 'other', status: 'would_send', body_preview: 'Simulado, no enviado', created_at: ago(45) },
            { account_id: a, patient_id: p, direction: 'inbound', status: 'received', body_preview: 'Gracias, allí estaré', created_at: ago(40) },
          ],
        })
        cy.task('db:insertRows', {
          table: 'email_messages',
          rows: [
            { account_id: a, patient_id: p, recipient_email: 'lucia@example.test', subject: 'Tu factura de octubre', sent_at: ago(30), delivered_at: ago(29), failed_at: null, dry_run: false, provider_message_id: `re_${now}_1` },
            { account_id: a, patient_id: p, recipient_email: 'lucia@example.test', subject: 'Prueba sin enviar', sent_at: ago(25), delivered_at: null, failed_at: null, dry_run: true, provider_message_id: null },
            { account_id: a, patient_id: p, recipient_email: 'nadie@example.test', subject: 'Rebotado', sent_at: ago(20), delivered_at: null, failed_at: ago(19), dry_run: false, provider_message_id: `re_${now}_2` },
          ],
        })
        cy.task('db:insertRows', { table: 'patient_app_messages', rows: [{ account_id: a, patient_id: p, direction: 'outbound', body: 'Te esperamos el jueves', created_at: ago(10) }] })

        // A real push send, through the route the record calls: it is logged
        // even though the patient has no device to receive it.
        cy.task('db:givePatientAppLogin', { accountId: a, patientId: p, email: `comms-${now}@example.test`, password: 'valencia2026' })
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: a, name: 'Puente' }] }).then(([ex]) => {
          cy.task<{ id: string }[]>('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: a, patient_id: p, exercise_id: ex.id, sets: 3, reps: '12' }] }).then(([pe]) => {
            cy.login(account.email, account.password)
            cy.visit('/reports')
            cy.request({ method: 'POST', url: '/api/exercises/notify-assigned', body: { patientExerciseId: pe.id } }).its('status').should('eq', 200)
          })
        })
      })

      cy.visit('/reports/communications')
      cy.get('[data-cy="communications-log"][data-ready="true"]')
      cy.get('[data-cy="comms-row"]').should('have.length', 5)
      cy.get('[data-cy="comms-count"]').should('contain', 'of 5')
      // Newest first: the push, then the app message.
      cy.get('[data-cy="comms-row"]').eq(0).should('contain', 'Push notification').and('contain', 'Nuevo ejercicio para casa: Puente · 3 × 12').and('contain', 'No device').and('contain', 'Lucía Navarro')
      cy.get('[data-cy="comms-row"]').eq(1).should('contain', 'App message').and('contain', 'Te esperamos el jueves')
      cy.get('[data-cy="communications-log"]').should('not.contain', 'Simulado').and('not.contain', 'Gracias, allí estaré').and('not.contain', 'Prueba sin enviar')

      cy.get('[data-cy="comms-channel"]').select('email')
      cy.get('[data-cy="comms-row"]').should('have.length', 2)
      cy.get('[data-cy="comms-status"]').select('failed')
      cy.get('[data-cy="comms-row"]').should('have.length', 1).and('contain', 'Rebotado').and('contain', 'Failed')
      cy.get('[data-cy="comms-status"]').select('')
      cy.get('[data-cy="comms-channel"]').select('')
      cy.get('[data-cy="comms-search"]').type('mañana')
      cy.get('[data-cy="comms-row"]').should('have.length', 1).and('contain', 'WhatsApp').and('contain', 'Reminder').and('contain', '+34600111222').and('contain', 'Read')
    })
  })

  it("does not show another clinic's messages", () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ajena', lastName: 'Persona' }).then((patient) => {
        cy.task('db:insertRows', { table: 'patient_app_messages', rows: [{ account_id: other.accountId, patient_id: patient.id, direction: 'outbound', body: 'Mensaje de otra clínica' }] })
      })
      cy.seedStaffAccount().then((mine) => {
        cy.login(mine.email, mine.password)
        cy.visit('/reports/communications')
        cy.get('[data-cy="communications-log"][data-ready="true"]')
        cy.get('[data-cy="communications-log"]').should('not.contain', 'Mensaje de otra clínica')
      })
    })
  })
})
