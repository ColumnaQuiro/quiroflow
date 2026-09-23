import { findFreeSlots, firstClash } from '../../../utils/freeSlots'
import { dateInputValue, openNewAppointmentPanel } from '../../support/calendar'

// The create panel answers four questions in order -- who, what for, with
// whom, when -- and the last one live: whether the time clashes, and the
// next times that do not.

describe('Free-slot rules', () => {
  const day = new Date('2026-09-24T00:00:00')
  const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m).getTime()
  const nineToTwo = () => [['09:00', '14:00']] as [string, string][]

  it('names the first booking a time overlaps', () => {
    const busy = [{ start: at(11), end: at(11, 30), label: 'Clara Vidal' }]
    expect(firstClash(at(11, 15), at(11, 45), busy)?.label).to.equal('Clara Vidal')
    expect(firstClash(at(11, 30), at(12), busy), 'back to back is not a clash').to.equal(null)
  })

  it('offers the next starts that fit inside the hours and around bookings', () => {
    const slots = findFreeSlots({
      from: day,
      durationMin: 60,
      stepMin: 30,
      windowsFor: nineToTwo,
      busy: [{ start: at(9, 30), end: at(10, 30) }],
      count: 4,
      days: 1,
    }).map((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`)
    // 09:00 would run into the 09:30 booking; 13:30 would run past 14:00.
    expect(slots).to.deep.equal(['10:30', '11:00', '11:30', '12:00'])
  })

  it('skips a day nobody works and carries on to the next', () => {
    const slots = findFreeSlots({
      from: day,
      durationMin: 30,
      stepMin: 30,
      windowsFor: (d) => (d.getDate() === 24 ? [] : nineToTwo()),
      busy: [],
      count: 1,
      days: 3,
    })
    expect(slots[0].getDate()).to.equal(25)
    expect(slots[0].getHours()).to.equal(9)
  })
})

function tomorrow(h = 0, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  return d
}

describe('Booking from the create panel', () => {
  it('searches, flags, catches a clash, offers another time and books it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, defaultPriceCents: 4500 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Vidal' }).then((clara) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: clara.id, practitionerId: account.teamMemberId, startsAt: tomorrow(11).toISOString() })
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marina', lastName: 'Soto' }).then((marina) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: marina.id, packageName: 'Bono 8', sessionsTotal: 8, sessionsUsed: 2 })
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'María', lastName: 'Ruiz' }).then((maria) => {
        cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: maria.id })
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      // The grid stays in view, with the slot being booked marked on it.
      cy.get('[data-cy=create-ghost]').should('contain.text', '09:00')

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.focused().should('have.attr', 'data-cy', 'create-patient-search')
        cy.get('[data-cy=create-submit]').should('be.disabled').and('contain.text', 'Choose a patient to book')

        cy.get('[data-cy=create-patient-search]').type('Mar')
        cy.contains('[data-cy=create-patient-result]', 'Marina Soto').should('contain.text', 'Bono 6/8')
        cy.contains('[data-cy=create-patient-result]', 'María Ruiz').should('contain.text', 'On waitlist')
        cy.get('[data-cy=create-new-patient]').should('contain.text', 'New patient “Mar”')
        cy.contains('[data-cy=create-patient-result]', 'Marina Soto').click()
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Marina Soto')

        cy.contains('[data-cy=create-type]', 'Ajuste').click().should('have.attr', 'aria-checked', 'true')
        cy.contains('[data-cy=create-type]', '30 min · 45,00 €').should('exist')

        // 11:00 tomorrow is Clara's.
        cy.get('input[type="date"]').clear().type(dateInputValue(tomorrow()))
        cy.get('input[type="time"]').clear().type('11:00')
        cy.get('[data-cy=create-clash]').should('contain.text', 'doesn’t fit').and('contain.text', 'Clara Vidal at 11:00')
        cy.contains('[data-cy=create-practitioner]', 'Test Owner').should('contain.text', 'With Clara Vidal')
        cy.get('[data-cy=create-submit]').should('be.disabled').and('contain.text', 'Choose another time')

        // The next free times; the first is the start of that day.
        cy.get('[data-cy=create-alternatives] button').should('have.length.at.least', 1).first().click()
        cy.get('input[type="time"]').should('have.value', '08:00')
        cy.get('[data-cy=create-clash]').should('not.exist')
        cy.get('[data-cy=create-free]').should('contain.text', 'is free')

        cy.get('[data-cy=create-send-confirmation]').should('be.checked')
        cy.get('[data-cy=create-submit]').should('not.be.disabled').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get('[aria-label="Next"]').click()
      cy.contains('[data-cy=appt-block]', 'Marina Soto').should('exist')
    })
  })

  it('moves the booking to another slot clicked on the grid, and starts a new patient from the search', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      // No backdrop: the grid is still there to click, and the booking follows.
      cy.get('[data-cal-col]').first().click(30, 200)
      cy.get('[data-cy=create-when]').should('contain.text', 'Room 1').and('not.contain.text', '09:00')

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-patient-search]').type('nadie zzz')
        cy.contains('No matches').should('exist')
        cy.get('[data-cy=create-new-patient]').click()
        cy.get('input[placeholder="First name"]').should('have.value', 'Nadie')
        cy.get('input[placeholder="Last name"]').should('have.value', 'zzz')
      })
      cy.get('body').type('{esc}')
      cy.get('[data-cy=create-sheet]').should('not.exist')
    })
  })
})
