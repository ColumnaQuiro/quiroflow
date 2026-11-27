import { todayAt } from '../../support/calendar'

// The week view gives each day a sub-column per room. At 128px each a working
// week with one room and Unassigned needed 1,338px, so on a 1440px laptop the
// grid scrolled sideways and Friday started off the screen; the sub-columns
// then shared out the width down to a floor of 76px. A clinic with six tables
// and a first-visit room still needed 3,040px at that floor and saw under two
// days at a time. The floor is now 18px: a laptop always shows the whole
// week, and a narrow block keeps the patient's first name or initials.

function rooms(account: { accountId: string; clinicId: string }, n: number) {
  cy.task('db:deleteRooms', { clinicId: account.clinicId })
  for (let i = 1; i <= n; i++) cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: `Sala ${i}` })
}

function fitsSideways() {
  cy.get('[data-cy=grid-scroller]').should(($el) => {
    const el = $el[0]!
    expect(el.scrollWidth, 'grid width').to.be.at.most(el.clientWidth + 1)
  })
}

describe('The week view on a laptop screen', () => {
  it('fits Monday to Friday at 1440px without scrolling sideways', () => {
    cy.viewport(1440, 900)
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').should('have.value', 'workweek')
      fitsSideways()
    })
  })

  // Horizon's shape: six tables, a first-visit room and Unassigned -- eight
  // sub-columns a day, fifty-six in a full week, some 20px each.
  it('fits a full week of seven rooms at 1440px, every visit still named', () => {
    cy.viewport(1440, 900)
    cy.seedStaffAccount().then((account) => {
      rooms(account, 7)
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Estrecha' }).then((p) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: todayAt(10), roomId: null }),
      )
      cy.login(account.email, account.password)
      // The full week, so the visit is on screen whichever day this runs.
      cy.visit('/calendar', { onBeforeLoad: (win) => win.localStorage.setItem('quiroflow-calendar-view-mode', 'week') })

      cy.get('[data-cy=grid-scroller] [data-cal-col]', { timeout: 30000 }).should('have.length', 56)
      fitsSideways()
      cy.get('[data-cy=appt-block] [aria-label*="Ana Estrecha"]').should('exist')
      // Narrow: the first name or the initials, whole -- never "A…".
      cy.get('[data-cy=appt-block] [data-cy=appt-block-name]').should(($n) => {
        const el = $n[0]!
        expect(['Ana', 'AE'], 'the name it prints').to.include(el.textContent!.trim())
        expect(el.scrollWidth, 'not cut').to.be.at.most(el.clientWidth + 1)
      })
    })
  })

  it('still scrolls rather than squeezing a narrow window past the floor', () => {
    // Nine rooms and Unassigned, five days: fifty sub-columns in the 730px a
    // 1024px window leaves the grid, under 15px each.
    cy.viewport(1024, 768)
    cy.seedStaffAccount().then((account) => {
      rooms(account, 9)
      cy.login(account.email, account.password)
      cy.visit('/calendar', { onBeforeLoad: (win) => win.localStorage.setItem('quiroflow-calendar-view-mode', 'workweek') })
      cy.get('[data-cy=grid-scroller] [data-cal-col]', { timeout: 30000 }).first().should(($col) => expect($col[0]!.getBoundingClientRect().width).to.be.at.least(17))
      cy.get('[data-cy=grid-scroller]').should(($el) => expect($el[0]!.scrollWidth).to.be.greaterThan($el[0]!.clientWidth))
    })
  })
})
