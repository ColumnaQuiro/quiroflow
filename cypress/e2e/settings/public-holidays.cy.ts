import { holidaysFor, HOLIDAYS_KNOWN_THROUGH } from '../../../utils/spanishHolidays'

// Settings -> Clinics -> <clinic> -> Cierres y festivos: the clinic closes on
// its comunidad's official holidays by itself (20261017165328_public_holidays,
// server/utils/publicHolidays.ts). Each is a whole-day closure tagged with its
// date; one removed by hand stays removed; a new region swaps them; the
// daily cron brings a year that ships later.
const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const runCron = () => cy.request({ method: 'POST', url: '/api/automations/same-day-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
type Block = { public_holiday: string | null; note: string | null; starts_at: string }
const officialClosures = (clinicId: string) =>
  cy.task<Block[]>('db:selectRows', { table: 'availability_blocks', columns: 'public_holiday, note, starts_at', match: { clinic_id: clinicId } }).then((rows) => rows.filter((r) => r.public_holiday).sort((a, b) => a.public_holiday!.localeCompare(b.public_holiday!)))

function openClinic(clinicId: string) {
  cy.visit(`/settings/clinics/${clinicId}`)
  cy.get('[data-cy=clinic-page]').should('have.attr', 'data-ready', 'true')
}

describe('Official public holidays', () => {
  it('closes the comunidad’s holidays, says which already have visits, and keeps a removed one removed', () => {
    const madrid = holidaysFor('ES-MD', madridToday(), HOLIDAYS_KNOWN_THROUGH)
    const first = madrid[0]!
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Festivo' }).then((p) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: `${first.date}T09:00:00Z`, status: 'booked' })
      })
      cy.login(account.email, account.password)
      openClinic(account.clinicId)
      cy.get('[data-cy=clinic-holidays]').should('exist')
      // Nothing to turn on until the comunidad is chosen.
      cy.get('[data-cy=holidays-auto]').should('be.disabled')
      cy.get('[data-cy=holiday-region]').select('Comunidad de Madrid')
      cy.get('[data-cy=holidays-preview]').should('contain', `${madrid.length}`)
      cy.get('[data-cy=holidays-auto]').click()
      cy.get('[data-cy=holidays-closed]').should('contain', `${madrid.length} holidays closed`)
      cy.get('[data-cy=holidays-booked-day]').should('have.length', 1).and('contain', first.name).and('contain', '1 visits')
      cy.get('[data-cy=clinic-closure-official]').should('have.length', madrid.length)

      officialClosures(account.clinicId).then((rows) => {
        expect(rows.map((r) => r.public_holiday)).to.deep.eq(madrid.map((h) => h.date))
        expect(rows[0]!.note).to.eq(`Festivo: ${first.name}`)
      })

      // Open on the first one after all: removed by hand, it does not come back.
      cy.get('[data-cy=clinic-closure]').first().find('[data-cy=clinic-closure-remove]').click()
      cy.get('[data-cy=confirm-dialog]').contains('button', 'Remove closure').click()
      cy.get('[data-cy=clinic-closure-official]').should('have.length', madrid.length - 1)
      runCron()
      officialClosures(account.clinicId).its('length').should('eq', madrid.length - 1)

      // A year that ships later reaches it from the cron: pretend this deploy
      // has just brought the last known year.
      const lastYear = Number(HOLIDAYS_KNOWN_THROUGH.slice(0, 4))
      cy.task('db:selectRows', { table: 'availability_blocks', columns: 'id, public_holiday', match: { clinic_id: account.clinicId } }).then((rows: any) => {
        const ids = rows.filter((r: any) => r.public_holiday && r.public_holiday >= `${lastYear}-01-01`).map((r: any) => r.id)
        for (const id of ids) cy.task('db:deleteRows', { table: 'availability_blocks', match: { id } })
      })
      cy.task('db:updateRows', { table: 'clinics', values: { holidays_loaded_through: `${lastYear - 1}-12-31` }, match: { id: account.clinicId } })
      runCron()
      officialClosures(account.clinicId).then((rows) => {
        expect(rows.map((r) => r.public_holiday)).to.deep.eq(madrid.slice(1).map((h) => h.date))
      })
      cy.task<{ holidays_loaded_through: string }[]>('db:selectRows', { table: 'clinics', columns: 'holidays_loaded_through', match: { id: account.clinicId } }).its('0.holidays_loaded_through').should('eq', HOLIDAYS_KNOWN_THROUGH)
    })
  })

  it('swaps the holidays with the comunidad, and turning it off reopens them', () => {
    const today = madridToday()
    const catalonia = holidaysFor('ES-CT', today, HOLIDAYS_KNOWN_THROUGH)
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openClinic(account.clinicId)
      cy.get('[data-cy=holiday-region]').select('Comunidad de Madrid')
      cy.get('[data-cy=holidays-auto]').click()
      cy.get('[data-cy=holidays-closed]').should('be.visible')
      cy.get('[data-cy=holiday-region]').select('Cataluña')
      cy.get('[data-cy=holidays-closed]').should('contain', `${catalonia.length} holidays closed`)
      officialClosures(account.clinicId).then((rows) => {
        expect(rows.map((r) => r.public_holiday)).to.deep.eq(catalonia.map((h) => h.date))
      })
      cy.get('[data-cy=holidays-auto]').click()
      cy.get('[data-cy=clinic-closure-official]').should('not.exist')
      officialClosures(account.clinicId).its('length').should('eq', 0)
      cy.task<{ holiday_region: string; holidays_auto: boolean }[]>('db:selectRows', { table: 'clinics', columns: 'holiday_region, holidays_auto', match: { id: account.clinicId } }).its('0').should('deep.include', { holiday_region: 'ES-CT', holidays_auto: false })
    })
  })

  it('is refused to a role without the clinic settings (Front Desk)', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `festivos-${Date.now()}@example.test`
      const password = 'valencia2026'
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password, fullName: 'Recepción' })
      cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
        cy.request({ method: 'POST', url: `/api/clinics/${account.clinicId}/holidays`, headers: { Authorization: `Bearer ${token}` }, body: { region: 'ES-MD', auto: true }, failOnStatusCode: false }).its('status').should('eq', 403)
      })
    })
  })
})
