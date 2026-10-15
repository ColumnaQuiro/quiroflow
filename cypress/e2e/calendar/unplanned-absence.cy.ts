import { dateInputValue } from '../../support/calendar'

// "Ausencia imprevista" on the Calendar: a practitioner is off tomorrow, and
// their visits go to a colleague where the colleague is free -- the rest stay
// and are listed -- or are cancelled the way the calendar cancels; either way
// their day is blocked first, so nothing hands those hours out again.
const tomorrowAt = (h: number) => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
const tomorrow = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return dateInputValue(d)
}

describe('Unplanned absence', () => {
  function clinic() {
    return cy.seedStaffAccount().then((account) =>
      cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email: `cover-${Date.now()}@example.test`, password: 'valencia2026', fullName: 'Pablo Gil', isPractitioner: true })
        .then((cover) =>
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Diez' }).then((a) =>
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Once' }).then((b) => {
              const visit = (patientId: string, practitionerId: string, h: number) =>
                cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId, startsAt: tomorrowAt(h) })
              return visit(a.id, account.teamMemberId, 10).then((va) =>
                visit(b.id, account.teamMemberId, 11).then((vb) => cy.wrap({ account, coverId: cover.teamMemberId, a, b, va, vb, visit })),
              )
            }),
          ),
        ),
    )
  }
  // The panel is lazy-loaded, so it can take a moment after the click; and a
  // click before hydration does nothing. Opening again is harmless (it only
  // sets it open), hence a forced retry rather than clickUntil, whose second
  // click would land on the panel's backdrop.
  function openPanel(attempt = 0) {
    cy.get('[data-cy=absence-open]').click({ force: true })
    cy.wait(500)
    cy.get('body').then(($body) => {
      if (!$body.find('[data-cy=absence]').length && attempt < 10) openPanel(attempt + 1)
    })
  }
  function openFor() {
    cy.contains('button', 'Unplanned absence', { timeout: 20000 })
    openPanel()
    cy.get('[data-cy=absence]').should('be.visible')
    cy.get('[data-cy=absence-who]').select('Test Owner')
    cy.get('[data-cy=absence-from]').clear().type(tomorrow())
    cy.get('[data-cy=absence-to]').clear().type(tomorrow())
    cy.get('[data-cy=absence-visit]').should('have.length', 2)
  }

  it('moves the visits to a colleague where they are free, keeps the rest, and blocks the day', () => {
    clinic().then(({ account, coverId, va, vb, visit }) => {
      // The colleague is busy at 11:00.
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carla', lastName: 'Ocupa' }).then((c) => visit(c.id, coverId, 11))
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openFor()
      cy.get('[data-cy=absence-action-move]').check()
      cy.get('[data-cy=absence-substitute]').select('Pablo Gil')
      cy.get('[data-cy=absence-apply]').click()
      cy.get('[data-cy=absence-moved]').should('contain', '1 moved')
      cy.get('[data-cy=absence-kept]').should('contain', 'Bruno Once').and('contain', 'busy')
      cy.task('db:appointmentById', { appointmentId: va.id }).its('practitioner_id').should('eq', coverId)
      cy.task('db:appointmentById', { appointmentId: vb.id }).its('practitioner_id').should('eq', account.teamMemberId)
      cy.task<{ practitioner_id: string; note: string }[]>('db:selectRows', { table: 'availability_blocks', columns: 'practitioner_id, note', match: { account_id: account.accountId } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.practitioner_id).to.eq(account.teamMemberId)
        expect(rows[0]!.note).to.contain('Unplanned absence')
      })
    })
  })

  it('cancels them, says nobody is told automatically, and gives the numbers to call', () => {
    clinic().then(({ account, va, vb }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openFor()
      cy.get('[data-cy=absence-action-cancel]').check()
      cy.get('[data-cy=absence-notice]').should('contain', 'No automation tells patients')
      cy.get('[data-cy=absence-apply]').click()
      cy.get('[data-cy=absence-cancelled]').should('contain', '2 cancelled')
      cy.task('db:appointmentById', { appointmentId: va.id }).its('status').should('eq', 'cancelled')
      cy.task('db:appointmentById', { appointmentId: vb.id }).its('status').should('eq', 'cancelled')
      cy.task('db:selectRows', { table: 'availability_blocks', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 1)
    })
  })
})
