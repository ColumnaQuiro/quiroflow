// Shifts and leave (20261016145412_shifts_and_leave.sql): someone asks for
// holiday from "Mi jornada"; an owner approves it on Registro de jornada >
// Turnos, which blocks that person's calendar and offers to move the visits
// they had; an owner changes one day's shift, and a clocked day more than 15
// minutes off it is flagged. Only owners decide, and only owners see Turnos.
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
/** "HH:MM" on `date` in Madrid, as an instant. */
function madridAt(date: string, hhmm: string) {
  const probe = new Date(`${date}T12:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')!.value
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '')
  return new Date(`${date}T${hhmm}:00${offset}`).toISOString()
}
/** The Monday after next, and the Friday of that week (YYYY-MM-DD). */
function weekAhead() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + 7)
  const mon = madridDate(d)
  const fri = new Date(d)
  fri.setDate(fri.getDate() + 4)
  return { mon, fri: madridDate(fri) }
}

describe('Shifts and leave', () => {
  function clinicWithFisio() {
    return cy.seedStaffAccount().then((account) => {
      const email = `turnos-${Date.now()}@example.test`
      const password = 'valencia2026'
      return cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password, fullName: 'Lucía Fisio', isPractitioner: true })
        .then((fisio) => cy.wrap({ account, fisio: { id: fisio.teamMemberId, email, password } }))
    })
  }

  it('asks for holiday, and an owner approves it: the calendar is blocked and the visits are offered for moving', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      const { mon, fri } = weekAhead()
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Visita' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: fisio.id, startsAt: madridAt(mon, '10:00') })
      })

      cy.login(fisio.email, fisio.password)
      cy.visit('/jornada')
      cy.get('[data-cy=my-leave]', { timeout: 20000 })
      cy.get('[data-cy=my-leave-left]').should('contain', '22')
      cy.clickUntil('[data-cy=my-leave-ask]', '[data-cy=my-leave-form]')
      cy.get('[data-cy=my-leave-kind-vacation]').click()
      cy.get('[data-cy=my-leave-from]').type(mon)
      cy.get('[data-cy=my-leave-to]').clear().type(fri)
      cy.get('[data-cy=my-leave-count]').should('contain', '5').and('contain', '17')
      cy.get('[data-cy=my-leave-note]').type('Viaje')
      cy.get('[data-cy=my-leave-send]').click()
      cy.get('[data-cy=my-leave-sent]').should('be.visible')
      cy.get('[data-cy=my-leave-request][data-status=pending]', { timeout: 15000 }).should('exist')
      // Not theirs to decide.
      cy.task<{ id: string }[]>('db:selectRows', { table: 'staff_absences', columns: 'id', match: { team_member_id: fisio.id } }).then(([absence]) => {
        cy.task<string>('db:accessTokenFor', { email: fisio.email, password: fisio.password }).then((token) => {
          cy.request({ method: 'POST', url: `/api/staff-absences/${absence!.id}/decide`, headers: { Authorization: `Bearer ${token}` }, body: { approve: true }, failOnStatusCode: false }).its('status').should('eq', 403)
        })
      })
      cy.get('[data-cy=jornada-tab-shifts]').should('not.exist')

      cy.clearAllCookies()
      cy.login(account.email, account.password)
      cy.visit('/jornada?tab=shifts')
      cy.get('[data-cy=leave-pending-row][data-name="Lucía Fisio"]', { timeout: 20000 }).should('contain', '5').and('contain', '1 visits booked')
      cy.get('[data-cy=leave-approve]').click()
      cy.get('[data-cy=leave-pending]').should('not.exist')
      cy.get('[data-cy=leave-visits]').should('contain', 'Lucía Fisio has 1 visits booked')

      cy.task<{ status: string; block_ids: string[] }[]>('db:selectRows', { table: 'staff_absences', columns: 'status, block_ids', match: { team_member_id: fisio.id } }).then(([absence]) => {
        expect(absence!.status).to.eq('approved')
        expect(absence!.block_ids).to.have.length(1)
      })
      cy.task<{ note: string; practitioner_id: string }[]>('db:selectRows', { table: 'availability_blocks', columns: 'note, practitioner_id', match: { account_id: account.accountId } }).then((blocks) => {
        expect(blocks).to.have.length(1)
        expect(blocks[0]!.practitioner_id).to.eq(fisio.id)
        expect(blocks[0]!.note).to.contain('Vacaciones')
      })
      // The days off come out of what is left.
      cy.get('[data-cy=leave-allowance-row][data-name="Lucía Fisio"]').should('contain', '17')

      // The visits that were booked those days, straight into "Ausencia imprevista".
      cy.get('[data-cy=leave-visits-move]').click()
      cy.get('[data-cy=absence]').should('be.visible')
      cy.get('[data-cy=absence-visit]').should('have.length', 1)
    })
  })

  it("changes one day's shift and flags a clocked day more than 15 minutes off it", () => {
    clinicWithFisio().then(({ account, fisio }) => {
      const today = madridDate(new Date())
      cy.task('db:insertRows', {
        table: 'time_entries',
        rows: [
          { account_id: account.accountId, team_member_id: fisio.id, work_date: today, kind: 'in', at: madridAt(today, '09:40') },
          { account_id: account.accountId, team_member_id: fisio.id, work_date: today, kind: 'out', at: madridAt(today, '14:05') },
        ],
      })
      cy.login(account.email, account.password)
      cy.visit('/jornada?tab=shifts')
      cy.get('[data-cy=shifts-row][data-name="Lucía Fisio"]', { timeout: 20000 }).find(`[data-cy=shift-cell-${today}]`).click()
      cy.get('[data-cy=shift-edit-input]').clear().type('9:00-14:00')
      cy.get('[data-cy=shift-edit-save]').click()
      cy.get('[data-cy=shifts-row][data-name="Lucía Fisio"]').find(`[data-cy=shift-cell-${today}]`).should('contain', '09:00–14:00')
      cy.task<{ ranges: [string, string][] }[]>('db:selectRows', { table: 'shift_days', columns: 'ranges', match: { team_member_id: fisio.id, day: today } }).its('0.ranges').should('deep.eq', [['09:00', '14:00']])

      cy.get('[data-cy=shift-gap]').should('have.length', 1).and('contain', 'Lucía Fisio').and('contain', 'in 09:40 (shift 09:00)')
      // 5 h on shift, 4 h 25 clocked.
      cy.get('[data-cy=shifts-row][data-name="Lucía Fisio"]').find('[data-cy=shifts-hours]').should('contain', '5 h 00').and('contain', '4 h 25')

      // Back to the usual hours.
      cy.get('[data-cy=shifts-row][data-name="Lucía Fisio"]').find(`[data-cy=shift-cell-${today}]`).click()
      cy.get('[data-cy=shift-edit-reset]').click()
      cy.task('db:selectRows', { table: 'shift_days', columns: 'day', match: { team_member_id: fisio.id } }).should('have.length', 0)
    })
  })
})
