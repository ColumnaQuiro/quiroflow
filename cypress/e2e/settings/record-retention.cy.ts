// Ajustes › Privacidad (20261017182107_record_retention.sql): records with no
// activity for longer than the clinic's period are listed for the owner, who
// keeps them on with a reason or anonymises them -- the clinical record and
// the contact details go, the visits and the money stay, and the activity
// log keeps who did what but no longer what the record said. Owners only.
const yearsAgo = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString()
}

describe('Record retention', () => {
  function oldPatient(account: { accountId: string; clinicId: string; teamMemberId: string }, firstName: string, years: number) {
    return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Antiguo' }).then((p) => {
      cy.task('db:updateRows', { table: 'patients', values: { created_at: yearsAgo(years), email: `${firstName.toLowerCase()}@example.test`, chief_complaint: 'Lumbalgia' }, match: { id: p.id } })
      return cy
        .task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: yearsAgo(years), status: 'completed' })
        .then((appt) => {
          cy.task('db:insertRows', { table: 'visit_notes', rows: [{ account_id: account.accountId, appointment_id: appt.id, body: 'S: dolor lumbar. A: ajuste L4.' }] })
          cy.task('db:updateRows', { table: 'visit_notes', values: { created_at: yearsAgo(years) }, match: { appointment_id: appt.id } })
          return cy.wrap({ id: p.id, appointmentId: appt.id })
        })
    })
  }

  it('lists the records past their period; keeps one with a reason and anonymises another', () => {
    cy.seedStaffAccount().then((account) => {
      oldPatient(account, 'Tomas', 8).then((tomas) => {
        oldPatient(account, 'Rosa', 7).then((rosa) => {
          oldPatient(account, 'Reciente', 2)
          cy.login(account.email, account.password)
          cy.visit('/settings/privacy')
          cy.get('[data-cy=privacy][data-ready=true]', { timeout: 20000 })
          cy.get('[data-cy=retention-row]').should('have.length', 2)
          cy.get(`[data-cy=retention-row][data-id="${tomas.id}"]`).should('contain', 'Tomas').and('contain', '1 notes')

          // Kept on, with a reason: off the list, under "Se conservan".
          cy.get(`[data-cy=retention-row][data-id="${tomas.id}"]`).find('[data-cy=retention-keep-one]').click()
          cy.get('[data-cy=retention-keep-reason]').type('Tratamiento previsible')
          cy.get('[data-cy=retention-keep-save]').click()
          cy.get('[data-cy=retention-row]').should('have.length', 1)
          cy.get('[data-cy=retention-kept-row]').should('contain', 'Tomas').and('contain', 'Tratamiento previsible')

          // Anonymised, typed to confirm.
          cy.get(`[data-cy=retention-row][data-id="${rosa.id}"]`).find('[data-cy=retention-select]').check()
          cy.get('[data-cy=retention-anonymize]').click()
          cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
          cy.get('[data-cy=confirm-dialog] input').type('ANONIMIZAR')
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.get('[data-cy=retention-row]').should('not.exist')

          cy.task<{ first_name: string; last_name: string; email: string | null; chief_complaint: string | null; anonymized_at: string | null }[]>('db:selectRows', { table: 'patients', columns: 'first_name, last_name, email, chief_complaint, anonymized_at', match: { id: rosa.id } }).then(([p]) => {
            expect(p).to.include({ first_name: 'Paciente', last_name: 'anonimizado', email: null, chief_complaint: null })
            expect(p!.anonymized_at).to.be.a('string')
          })
          cy.task('db:selectRows', { table: 'visit_notes', columns: 'id', match: { appointment_id: rosa.appointmentId } }).should('have.length', 0)
          // The visit stays, for the clinic's figures and its invoices.
          cy.task('db:selectRows', { table: 'appointments', columns: 'id', match: { id: rosa.appointmentId } }).should('have.length', 1)
          // The trail keeps who and when, not what the note said.
          cy.task<{ snapshot: unknown; changes: unknown; summary: string }[]>('db:selectRows', { table: 'audit_logs', columns: 'snapshot, changes, summary', match: { patient_id: rosa.id } }).then((rows) => {
            expect(rows.length).to.be.greaterThan(1)
            expect(rows.filter((r) => r.snapshot || r.changes)).to.have.length(0)
            expect(rows.map((r) => r.summary)).to.include('Historia anonimizada por plazo de conservación cumplido')
          })
          // The kept one, and the recent one, are untouched.
          cy.task('db:selectRows', { table: 'visit_notes', columns: 'id', match: { appointment_id: tomas.appointmentId } }).should('have.length', 1)
        })
      })
    })
  })

  it('refuses a record inside its period, and anyone but an owner', () => {
    cy.seedStaffAccount().then((account) => {
      oldPatient(account, 'Dentro', 3).then((inside) => {
        oldPatient(account, 'Fuera', 9).then((outside) => {
          cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
            cy.request({ method: 'POST', url: '/api/patients/anonymize', headers: { Authorization: `Bearer ${token}` }, body: { patientIds: [inside.id] }, failOnStatusCode: false })
              .its('body.statusMessage')
              .should('contain', 'inside its retention period')
          })
          const email = `privacidad-${Date.now()}@example.test`
          const password = 'valencia2026'
          cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password, fullName: 'Fisio' })
          cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
            cy.request({ method: 'POST', url: '/api/patients/anonymize', headers: { Authorization: `Bearer ${token}` }, body: { patientIds: [outside.id] }, failOnStatusCode: false }).its('status').should('eq', 403)
          })
          cy.task('db:selectRows', { table: 'visit_notes', columns: 'id', match: { appointment_id: outside.appointmentId } }).should('have.length', 1)
          cy.login(email, password)
          cy.visit('/settings/privacy')
          cy.location('pathname', { timeout: 20000 }).should('not.eq', '/settings/privacy')
        })
      })
    })
  })

  it('changes the period, and lists consents about to expire', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carmen', lastName: 'Consentimiento' }).then((p) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'doc_templates', rows: [{ account_id: account.accountId, title: 'Consentimiento de tratamiento', fields: [], category: 'consent', valid_months: 12 }] }).then(([tpl]) => {
          const signed = new Date(Date.now() - 350 * 86400_000).toISOString()
          cy.task('db:insertRows', { table: 'patient_docs', rows: [{ account_id: account.accountId, patient_id: p.id, template_id: tpl!.id, title: 'Consentimiento de tratamiento', fields: [], completed_at: signed }] })
        })
        cy.login(account.email, account.password)
        cy.visit('/settings/privacy')
        cy.get('[data-cy=privacy][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=consent-expiring]').should('have.length', 1).and('contain', 'Carmen Consentimiento').and('contain', 'Consentimiento de tratamiento')
        cy.get('[data-cy=consent-expiring] a').should('have.attr', 'href', `/patients/${p.id}?tab=docs`)

        cy.get('[data-cy=retention-years]').clear().type('8')
        cy.get('[data-cy=retention-years-save]').click()
        cy.task<{ clinical_retention_years: number }[]>('db:selectRows', { table: 'accounts', columns: 'clinical_retention_years', match: { id: account.accountId } }).its('0.clinical_retention_years').should('eq', 8)
      })
    })
  })
})
