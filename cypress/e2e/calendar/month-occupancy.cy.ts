// The calendar's Month view (components/calendar/MonthOccupancy.vue,
// utils/monthOccupancy.ts): each day's share of the practitioner's working
// time that is booked, and the hours still free. A day opens in Day view.
function weekdayMidMonth(): Date {
  const d = new Date()
  d.setDate(15)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d
}

describe('Calendar month view', () => {
  it('shows how full each day is and what is left, and opens a day', () => {
    cy.seedStaffAccount().then((account) => {
      const week: Record<string, [string, string][]> = { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']], sat: [], sun: [] }
      cy.task('db:updateRows', { table: 'team_members', values: { business_hours: week }, match: { id: account.teamMemberId } })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mes', lastName: 'Lleno' }).then((patient) => {
        const day = weekdayMidMonth()
        for (const hour of [10, 11]) {
          const at = new Date(day)
          at.setHours(hour)
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: at.toISOString(), durationMinutes: 60 })
        }

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.get('select[aria-label="View"]').select('month')
        cy.get('[data-cy=calendar-month][data-ready=true]', { timeout: 20000 })

        // 8 h of work, 2 h booked: a quarter, 6 h free.
        cy.get(`[data-cy=month-day][data-in-month][data-day=${day.getDate()}]`).within(() => {
          cy.get('[data-cy=month-day-share]').should('have.text', '25 %')
          cy.get('[data-cy=month-day-free]').should('contain', '6 h')
        })
        cy.get('[data-cy=month-visits]').should('have.text', '2')

        cy.get(`[data-cy=month-day][data-in-month][data-day=${day.getDate()}]`).click()
        cy.get('select[aria-label="View"]').should('have.value', 'day')
        cy.get('[data-cy=calendar-month]').should('not.exist')
      })
    })
  })
})
