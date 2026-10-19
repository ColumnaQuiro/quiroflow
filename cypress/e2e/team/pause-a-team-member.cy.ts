// Pausing a team member (20261019085552_pause_a_team_member.sql): an owner
// marks a practitioner as away from Settings > Team -- maternity leave, with
// no return date yet -- and their calendar is blocked from that day on, so
// nothing offers their time. A return date moves the end of the block;
// "back today" on an absence that started today takes it away. Only an owner
// can record one.
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
type Absence = { id: string; kind: string; starts_on: string; ends_on: string; status: string; block_ids: string[] }
type Block = { id: string; starts_at: string; ends_at: string; note: string | null }

describe('Pausing a team member', () => {
  function clinicWithFisio() {
    return cy.seedStaffAccount().then((account) => {
      const email = `ausencia-${Date.now()}@example.test`
      const password = 'valencia2026'
      return cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password, fullName: 'Lucía Fisio', isPractitioner: true })
        .then((fisio) => cy.wrap({ account, fisio: { id: fisio.teamMemberId, email, password } }))
    })
  }

  it('marks a practitioner away until further notice, blocks their calendar, and moves the end when they come back', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      const today = madridDate(new Date())
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Visita' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: fisio.id, startsAt: new Date(Date.now() + 3 * 86400_000).toISOString() })
      })

      cy.login(account.email, account.password)
      cy.visit(`/settings/team/${fisio.id}`)
      cy.get('[data-cy=member-absence][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=member-away-chip]').should('not.exist')
      cy.get('[data-cy=member-absence-add]').click()
      cy.get('[data-cy=member-absence-kind-parental]').click()
      cy.get('[data-cy=member-absence-from]').should('have.value', today)
      cy.get('[data-cy=member-absence-save]').click()

      cy.get('[data-cy=member-absence-row]').should('have.length', 1)
      cy.get('[data-cy=member-absence-span]').should('contain', 'no return date yet')
      cy.get('[data-cy=member-away-chip]').should('contain', 'Parental leave')
      // The visit already booked with her is not moved by this, only pointed out.
      cy.get('[data-cy=member-absence-booked]').should('contain', '1')

      cy.task<Absence[]>('db:selectRows', { table: 'staff_absences', columns: 'id, kind, starts_on, ends_on, status, block_ids', match: { team_member_id: fisio.id } }).then(([absence]) => {
        expect(absence).to.include({ kind: 'parental', starts_on: today, ends_on: '2999-12-31', status: 'approved' })
        expect(absence!.block_ids).to.have.length(1)
        cy.task<Block[]>('db:selectRows', { table: 'availability_blocks', columns: 'id, starts_at, ends_at, note', match: { id: absence!.block_ids[0] } }).then(([block]) => {
          expect(new Date(block!.ends_at).getUTCFullYear()).to.be.greaterThan(2900)
          expect(block!.note).to.contain('Maternidad / paternidad')
        })

        // Back in a fortnight: the block now ends that morning.
        const back = plusDays(today, 14)
        cy.get('[data-cy=member-absence-return]').click()
        cy.get('[data-cy=member-absence-new-return]').type(back)
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=member-absence-span]').should('not.contain', 'no return date yet')
        cy.task<Block[]>('db:selectRows', { table: 'availability_blocks', columns: 'id, starts_at, ends_at, note', match: { id: absence!.block_ids[0] } }).then(([block]) => {
          expect(madridDate(new Date(block!.ends_at))).to.eq(back)
          expect(new Date(block!.ends_at).toLocaleTimeString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })).to.eq('00:00')
        })

        // Back today, on the day it started: there was no absence after all.
        cy.get('[data-cy=member-absence-back]').click()
        cy.get('[data-cy=member-absence-row]').should('not.exist')
        cy.get('[data-cy=member-away-chip]').should('not.exist')
        cy.task<Absence[]>('db:selectRows', { table: 'staff_absences', columns: 'id, kind, starts_on, ends_on, status, block_ids', match: { id: absence!.id } }).its('0.status').should('eq', 'cancelled')
        cy.task<Block[]>('db:selectRows', { table: 'availability_blocks', columns: 'id', match: { id: absence!.block_ids[0] } }).should('have.length', 0)
      })
    })
  })

  it('lets only an owner record one, and holidays need a return date', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      const today = madridDate(new Date())
      cy.task<{ data: unknown; error: string | null }>('db:callRpcAs', { email: fisio.email, password: fisio.password, fn: 'record_staff_absence', args: { p_team_member_id: fisio.id, p_kind: 'sick', p_starts_on: today } })
        .its('error')
        .should('contain', 'Only an owner')
      cy.task<{ data: unknown; error: string | null }>('db:callRpcAs', { email: account.email, password: account.password, fn: 'record_staff_absence', args: { p_team_member_id: fisio.id, p_kind: 'vacation', p_starts_on: today } })
        .its('error')
        .should('contain', 'Holidays need the day they are back')
      cy.task<Absence[]>('db:selectRows', { table: 'staff_absences', columns: 'id', match: { team_member_id: fisio.id } }).should('have.length', 0)

      // The practitioner sees the section, but not the button.
      cy.login(fisio.email, fisio.password)
      cy.visit(`/settings/team/${fisio.id}`, { failOnStatusCode: false })
      cy.get('body').then(($body) => {
        if ($body.find('[data-cy=member-absence]').length) cy.get('[data-cy=member-absence-add]').should('not.exist')
      })
    })
  })
})
