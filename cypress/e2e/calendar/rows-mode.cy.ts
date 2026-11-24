import { todayAt } from '../../support/calendar'

// An open treatment room: one room, several tables, many visits at the same
// time. Side by side ("columns", the default) they split the column into
// lanes, and past six the rest collapse into "+N more". Rows mode stacks them
// one under the other at full width, the hour growing to fit, and the choice
// is remembered across a reload.

const PATIENTS = ['Ana Ruiz', 'Bruno Vidal', 'Clara Soler', 'Diego Mora', 'Elena Paz', 'Félix Gil', 'Gloria Sanz', 'Hugo León']

function boxes() {
  return cy.get('[data-cy=appt-block]').then(($els) => [...$els].map((el) => el.getBoundingClientRect()))
}

describe('Visits at the same time, in rows', () => {
  it('stacks a crowded hour one under the other, full width, and remembers it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala abierta' }).then((room) => {
        for (const name of PATIENTS) {
          const [first, last] = name.split(' ')
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last }).then((patient) =>
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, roomId: room.id, startsAt: todayAt(10, 0), durationMinutes: 45 }),
          )
        }
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      // Columns: six lanes, the last of them the "+3 more" chip. The switch
      // is in the toolbar's display popover.
      cy.clickUntil('[data-cy=calendar-display]', '[data-cy=calendar-display-panel]')
      cy.get('[data-cy=stack-mode-columns]').should('have.attr', 'aria-pressed', 'true')
      cy.get('[data-cy=appt-block]').should('have.length', 5)
      cy.contains('+3 more').should('exist')

      cy.get('[data-cy=stack-mode-rows]').click()
      cy.get('[data-cy=stack-mode-rows]').should('have.attr', 'aria-pressed', 'true')
      cy.contains('+3 more').should('not.exist')
      cy.get('[data-cy=appt-block]').should('have.length', PATIENTS.length)
      for (const name of PATIENTS) cy.contains('[data-cy=appt-block-name]', name).should('exist')
      // Each row says its time, since rows are not drawn at their exact times.
      cy.get('[data-cy=appt-block-lead-time]').should('have.length', PATIENTS.length).first().should('have.text', '10:00')

      cy.get('[data-cal-col]')
        .then(($cols) => $cols.filter((_, el) => !!el.querySelector('[data-cy=appt-block]'))[0].getBoundingClientRect())
        .then((col) => {
          boxes().then((rects) => {
            const sorted = [...rects].sort((a, b) => a.top - b.top)
            for (const [i, r] of sorted.entries()) {
              // Full width, not a lane.
              expect(r.width, `row ${i} width`).to.be.greaterThan(col.width * 0.9)
              // Under the one before, not over it.
              if (i > 0) expect(r.top, `row ${i} top`).to.be.at.least(sorted[i - 1].bottom - 0.5)
            }
            // The 10:00 hour grew past its usual height to hold eight rows,
            // so the eleven o'clock line sits below the last of them.
            cy.document().then((doc) => {
              const eleven = [...doc.querySelectorAll('[data-cy=grid-scroller] span')].find((el) => el.textContent?.trim() === '11:00')
              expect(eleven, '11:00 label').to.exist
              expect(eleven!.getBoundingClientRect().top + 7).to.be.at.least(sorted[sorted.length - 1].bottom - 0.5)
            })
          })
        })

      // Remembered: a reload opens in rows.
      cy.reload()
      cy.clickUntil('[data-cy=calendar-display]', '[data-cy=calendar-display-panel]')
      cy.get('[data-cy=stack-mode-rows]').should('have.attr', 'aria-pressed', 'true')
      cy.get('[data-cy=appt-block]').should('have.length', PATIENTS.length)

      // And back.
      cy.get('[data-cy=stack-mode-columns]').click()
      cy.contains('+3 more').should('exist')
      cy.reload()
      cy.clickUntil('[data-cy=calendar-display]', '[data-cy=calendar-display-panel]')
      cy.get('[data-cy=stack-mode-columns]').should('have.attr', 'aria-pressed', 'true')
      cy.contains('+3 more').should('exist')
    })
  })
})
