// Two report bugs that were invisible on a single-clinic, small account:
//
//  - The clinic filter. ReportsPractitionerClinicFilters declared
//    `showClinic?: boolean`, which Vue casts to false when a page leaves it
//    out, so no report ever showed its clinic picker although every one of
//    them filters by it. The dashboard is the one place that hides it on
//    purpose (the sidebar's clinic already scopes it).
//  - The custom report's Patients source read one unpaged select, which
//    PostgREST caps at 1,000 rows, so a bigger clinic's counts stopped there.
const REPORTS_WITH_CLINIC_FILTER = [
  '/reports/income',
  '/reports/income-performance',
  '/reports/statistics',
  '/reports/daily-transactions',
  '/reports/appointment-distribution',
]

describe('Reports: clinic filter and large patient lists', () => {
  let owner: { email: string; password: string }
  let accountId: string

  before(() => {
    cy.seedStaffAccount().then((account) => {
      owner = { email: account.email, password: account.password }
      accountId = account.accountId
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Clínica Norte' }).then((north) => {
        // 1,040 in the first clinic and 12 in the second: past the 1,000-row
        // cap, and split so a clinic filter has something to tell apart.
        cy.task<{ patientIds: string[] }>('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 1040 }, { timeout: 60000 }).then(({ patientIds }) => {
          // Mornings, a few days ago: inside the distribution report's
          // default month, in its "Morning" shift. Two in the first clinic,
          // one in the second.
          const morning = (daysAgo: number) => {
            const d = new Date()
            d.setDate(d.getDate() - daysAgo)
            d.setHours(10, 0, 0, 0)
            return d.toISOString()
          }
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patientIds[0], startsAt: morning(3), status: 'completed' })
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patientIds[1], startsAt: morning(4), status: 'completed' })
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: north.id, patientId: patientIds[2], startsAt: morning(5), status: 'completed' })
        })
        cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: north.id, count: 12 })
      })
    })
  })

  beforeEach(() => cy.login(owner.email, owner.password))

  it('every report offers the clinic filter; the dashboard does not', () => {
    for (const path of REPORTS_WITH_CLINIC_FILTER) {
      cy.visit(path)
      cy.get('[data-cy="report-clinic-filter"]', { timeout: 15000 }).should('be.visible').find('option').should('have.length', 3)
      cy.get('[data-cy="report-clinic-filter"]').find('option').should('contain', 'Clínica Norte')
    }
    cy.visit('/dashboard')
    cy.get('[data-cy="report-practitioner-filter"]').should('be.visible')
    cy.get('[data-cy="report-clinic-filter"]').should('not.exist')
  })

  it('picking a clinic narrows the figures to it', () => {
    cy.visit('/reports/appointment-distribution')
    const morningTotal = () => cy.contains('p', 'Morning (before 12pm)').parent().find('p.font-mono')
    morningTotal().should('have.text', '3')
    cy.get('[data-cy="report-clinic-filter"]').select('Clínica Norte')
    morningTotal().should('have.text', '1')
    cy.get('[data-cy="report-clinic-filter"]').select('All clinics')
    morningTotal().should('have.text', '3')
  })

  it('the custom report counts every patient, not the first 1,000', () => {
    cy.visit('/reports/custom')
    cy.contains('label', 'Data source').parent().find('select').select('Patients')
    cy.contains('label', 'Chart').parent().find('select').select('Table')
    // Summed across whatever rows the grouping gives, against the account's
    // own count -- 1,052 seeded here plus anything the staff seed adds.
    cy.task<number>('db:patientCount', { accountId }).then((expected) => {
      expect(expected).to.be.greaterThan(1000)
      cy.get('table tbody tr td:last-child').should(($cells) => {
        const total = [...$cells].reduce((sum, td) => sum + Number(td.textContent), 0)
        expect(total).to.eq(expected)
      })
    })
  })
})
