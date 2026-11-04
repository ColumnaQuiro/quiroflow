// The whole clinical history, read and taken away. Asked for on 4 Nov 2026:
// the Clinical tab shut one note whenever the next opened, so the history
// could only be read a visit at a time, and there was no way to have it as a
// file the way PracticeHub gives it.

const PASSWORD = 'Test1234!'

function seedHistory(account: { accountId: string; clinicId: string }, firstName: string) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Historial' }).then((patient) => {
    const visit = (daysAgo: number, body: string) =>
      cy
        .task<{ id: string }>('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
          status: 'completed',
        })
        .then((appt) => cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body }))
    return visit(2, 'Subjective: Visita reciente.')
      .then(() => visit(20, 'Subjective: Visita intermedia.'))
      .then(() => visit(40, 'Subjective: Primera visita.'))
      .then(() => cy.wrap(patient))
  })
}

describe('Clinical history', () => {
  it('keeps a note open when another one is opened', () => {
    cy.seedStaffAccount().then((account) => {
      seedHistory(account, 'Varias').then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('li', 'Visita reciente').find('dt').should('exist')
        cy.contains('li', 'Primera visita').contains('button', 'Open').click()
        // The decisive part: the newest is still open beside it.
        cy.contains('li', 'Primera visita').find('dt').should('exist')
        cy.contains('li', 'Visita reciente').find('dt').should('exist')
        cy.contains('li', 'Visita intermedia').find('dt').should('not.exist')
      })
    })
  })

  it('opens and closes every note at once', () => {
    cy.seedStaffAccount().then((account) => {
      seedHistory(account, 'Todas').then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.get('[data-cy=notes-toggle-all]').should('have.text', 'Open all').click()
        cy.get('section[aria-labelledby=clin-notes] li').should('have.length', 3).each(($li) => cy.wrap($li).find('dt').should('exist'))
        cy.get('[data-cy=notes-toggle-all]').should('have.text', 'Close all').click()
        cy.get('section[aria-labelledby=clin-notes] li dt').should('not.exist')
      })
    })
  })

  it('downloads every note as a PDF, logged in the access log', () => {
    cy.seedStaffAccount().then((account) => {
      seedHistory(account, 'Descarga').then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.intercept('GET', `/api/patients/${patient.id}/clinical-history*`).as('history')
        cy.get('[data-cy=clinical-history-pdf]').click()
        cy.wait('@history').then(({ response }) => {
          expect(response?.statusCode).to.eq(200)
          expect(response?.headers['content-type']).to.contain('application/pdf')
        })

        cy.request({ url: `/api/patients/${patient.id}/clinical-history?lang=es`, encoding: 'binary' }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.slice(0, 5)).to.eq('%PDF-')
        })

        // Leaving the building with a patient's notes is an export, and it
        // says how many went.
        cy.task<{ kind: string; detail: { document: string; notes: number } }[]>('db:selectRows', {
          table: 'patient_access_log',
          columns: 'kind, detail',
          match: { patient_id: patient.id, kind: 'export' },
        }).then((rows) => {
          expect(rows.length).to.be.at.least(1)
          expect(rows[0]!.detail.document).to.eq('clinical_history')
          expect(rows[0]!.detail.notes).to.eq(3)
        })
      })
    })
  })

  it('is refused to a role that cannot see visit notes', () => {
    cy.seedStaffAccount().then((account) => {
      seedHistory(account, 'Sinpermiso').then((patient) => {
        const email = `hist-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { patients_scope: 'all', visit_notes_access: false } })
        cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción' })
        cy.login(email, PASSWORD)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        // Nothing to read, so nothing to download.
        cy.contains('No visit notes yet').should('be.visible')
        cy.get('[data-cy=clinical-history-pdf]').should('not.exist')
        cy.request({ url: `/api/patients/${patient.id}/clinical-history`, failOnStatusCode: false }).its('status').should('eq', 403)
      })
    })
  })
})
