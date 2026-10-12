// The Retention report (/reports/retention): who came back, by the month of
// their first visit; who left each practitioner with the next visit booked;
// and care plans left unfinished. The arithmetic is unit-tested
// (tests/unit/retention-stats.test.ts); this pins the page to real rows.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const at = (d: Date) => {
  const x = new Date(d)
  x.setHours(10, 0, 0, 0)
  return x.toISOString()
}

describe('Retention report', () => {
  it('shows who came back and who rebooked, from the visits that happened', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Retención' })
      const visit = (patientId: string, when: Date, extra: Record<string, unknown> = {}) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId: account.teamMemberId, startsAt: at(when), status: 'completed', createdAt: new Date(when.getTime() - 7 * 86_400_000).toISOString(), ...extra })

      patient('Vuelve').then((vuelve) => {
        patient('Una').then((una) => {
          // Came 100 days ago, booked the next one during that visit, and came again.
          visit(vuelve.id, daysAgo(100))
          visit(vuelve.id, daysAgo(90), { createdAt: new Date(new Date(at(daysAgo(100))).getTime() + 20 * 60_000).toISOString() })
          // Came 95 days ago, once.
          visit(una.id, daysAgo(95))

          cy.login(account.email, account.password)
          cy.visit('/reports/retention')
          cy.get('[data-cy=retention]').should('have.attr', 'data-ready', 'true')
          cy.get('[data-cy=retention-new]').should('have.text', '2')
          cy.get('[data-cy=retention-came-back]').should('have.text', '50%')
          // Three visits, one of which left with the next booked.
          cy.get('[data-cy=retention-rebooked]').should('have.text', '33%')
          cy.get('[data-cy=retention-cohort-row]').should('have.length.at.least', 1)
          cy.get('[data-cy=retention-plans-empty]').should('be.visible')
        })
      })
    })
  })

  it('is listed among the reports', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/reports')
      cy.contains('a', 'Retention').should('have.attr', 'href', '/reports/retention')
    })
  })

  it('says how many contacted patients booked, and messages unfinished plans in bulk', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
    cy.seedStaffAccount().then((account) => {
      const patient = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Plan' })
      const behind = (id: string) => {
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: id, totalVisits: 10, startedAt: daysAgo(80).toISOString().slice(0, 10) })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: id, practitionerId: account.teamMemberId, startsAt: at(daysAgo(50)), status: 'completed', createdAt: daysAgo(57).toISOString() })
      }
      patient('Conmovil').then((conMovil) => {
        patient('Sinmovil').then((sinMovil) => {
          behind(conMovil.id)
          behind(sinMovil.id)
          cy.task('db:addPatientContactNumber', { accountId: account.accountId, patientId: conMovil.id, number: '600111222', isWhatsapp: true })
          // Contacted 40 days ago and booked a week later: won back.
          cy.task('db:logContact', { accountId: account.accountId, patientId: conMovil.id, createdAt: daysAgo(40).toISOString() })
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: conMovil.id, practitionerId: account.teamMemberId, startsAt: at(daysAgo(20)), status: 'cancelled', createdAt: daysAgo(33).toISOString() })
          // Contacted 35 days ago, nothing since.
          cy.task('db:logContact', { accountId: account.accountId, patientId: sinMovil.id, createdAt: daysAgo(35).toISOString() })

          cy.login(account.email, account.password)
          cy.visit('/reports/retention')
          cy.get('[data-cy=retention]').should('have.attr', 'data-ready', 'true')
          cy.get('[data-cy=retention-win-back]').should('contain.text', '1').and('contain.text', 'of 2 contacted booked').and('contain.text', '50%')

          cy.get('[data-cy=retention-plan-row]').should('have.length', 2)
          cy.get('[data-cy=retention-plans-all]').check()
          cy.get('[data-cy=retention-plans-bulk]').should('contain.text', '2 selected').and('contain.text', '1 without a phone, skipped')
          cy.get('[data-cy=retention-plans-whatsapp]').should('contain.text', 'WhatsApp 1').click()
          // The same bulk send as Recalls, for the one with a phone.
          cy.contains('h3', 'Send WhatsApp to').should('contain.text', '1 patient')
        })
      })
    })
  })
})

