// "Exportar sus datos (RGPD)": everything held about a patient as a ZIP, for
// a right of access request (server/api/patients/[id]/gdpr-export.post.ts).
// Owners only, logged in the patient's access log, and handed back as a
// short-lived link because a record with photos is too big to answer with.
describe('GDPR export of a patient', () => {
  it('gives an owner a ZIP of the record, and logs that it was exported', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Datos' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() - 86400000).toISOString(), status: 'completed' }).then((appt) => {
          cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body: 'Subjective: Dolor lumbar 5/10.' })
          cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: appt.id, practitioner_score: 5 }] })
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.get('button[aria-label="More actions"]', { timeout: 20000 }).click()
        cy.get('[data-cy=patient-export-data]').should('contain', 'Export their data (GDPR)')

        cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
          cy.request({ method: 'POST', url: `/api/patients/${patient.id}/gdpr-export`, headers: { Authorization: `Bearer ${token}` } }).its('body').then((body) => {
            expect(body.fileName).to.match(/^datos-olga-datos-\d{4}-\d{2}-\d{2}\.zip$/)
            expect(body.counts).to.include({ citas: 1, notas: 1 })
            cy.request({ url: body.url, encoding: 'binary' }).its('body').then((zip: string) => {
              expect(zip.slice(0, 2), 'a ZIP').to.eq('PK')
              expect(zip).to.contain('LEEME.txt').and.contain('03_historia_clinica.json').and.contain('Dolor lumbar 5/10')
            })
          })
        })
        cy.task<{ kind: string; detail: { gdpr: boolean } }[]>('db:selectRows', { table: 'patient_access_log', columns: 'kind, detail', match: { patient_id: patient.id, kind: 'export' } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.detail.gdpr).to.eq(true)
        })
      })
    })
  })

  it('is refused to anyone who is not an owner', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Privada' }).then((patient) => {
        const email = `desk-${Date.now()}@example.test`
        const password = 'valencia2026'
        cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password, fullName: 'Recepción' })
        cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
          cy.request({ method: 'POST', url: `/api/patients/${patient.id}/gdpr-export`, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).its('status').should('eq', 403)
        })
        cy.login(email, password)
        cy.visit(`/patients/${patient.id}`)
        cy.get('button[aria-label="More actions"]', { timeout: 20000 }).click()
        cy.get('[data-cy=patient-export-data]').should('not.exist')
      })
    })
  })
})
