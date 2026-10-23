// Reasons for stopping care (20261022171626): the list in Settings > Recalls,
// a reason given when a patient is dismissed from Recalls, changed and
// cleared on their record, and counted in Reports > Retention. Every step is
// clicked and checked in the database.

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}
interface Stop { reason_id: string | null; note: string | null; recorded_by: string | null; practitioner_id: string | null }
interface Reason { id: string; name: string }

describe('Reasons for stopping care', () => {
  it('is recorded from Recalls and the record, and counted in Retention', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Laura', lastName: 'Baja', defaultPractitionerId: account.teamMemberId, phone: '612345678' }).then((laura) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: laura.id, practitionerId: account.teamMemberId, startsAt: daysAgo(70), status: 'completed' })
        const stops = () => cy.task<Stop[]>('db:selectRows', { table: 'patient_care_stops', columns: 'reason_id, note, recorded_by, practitioner_id', match: { patient_id: laura.id } })
        const reasons = () => cy.task<Reason[]>('db:selectRows', { table: 'care_stop_reasons', columns: 'id, name', match: { account_id: account.accountId } })
        const reasonId = (name: string) => reasons().then((rows) => rows.find((r) => r.name === name)!.id)

        // The list starts with the defaults, and takes a new one.
        cy.login(account.email, account.password)
        cy.visit('/settings/recalls')
        cy.get('[data-cy=care-stop-settings]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=stop-reason-name]').should('have.length', 6).first().should('have.text', 'Mejoró')
        cy.get('[data-cy=stop-reason-new-name]').type('Embarazo')
        cy.get('[data-cy=stop-reason-new-save]').click()
        cy.contains('[data-cy=stop-reason-name]', 'Embarazo').should('exist')

        // Dismissed from Recalls with a reason and a note.
        cy.visit('/recalls')
        cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
        cy.get(`[data-cy=recall-row][data-patient-id="${laura.id}"]`).find('[data-cy=recall-more]').click()
        cy.get('[data-cy=recall-dismiss]').click()
        cy.get('[data-cy=care-stop-reason]').select('Precio')
        cy.get('[data-cy=care-stop-note]').type('Le sube la cuota')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get(`[data-cy=recall-row][data-patient-id="${laura.id}"]`).should('not.exist')
        reasonId('Precio').then((precio) => {
          stops().should((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]).to.deep.equal({ reason_id: precio, note: 'Le sube la cuota', recorded_by: account.teamMemberId, practitioner_id: account.teamMemberId })
          })
        })

        // The Dismissed tab says why.
        cy.get('[data-cy=recalls-tab-dismissed]').click()
        cy.contains('[data-cy=parked-row]', 'Laura Baja').find('[data-cy=parked-stop-reason]').should('have.text', 'Precio')

        // Changed on the record: the same stop, not a second one.
        cy.visit(`/patients/${laura.id}`)
        cy.get('[data-cy=care-stop-reason-name]').should('have.text', 'Precio')
        cy.get('[data-cy=patient-care-stop]').should('contain.text', 'Le sube la cuota')
        cy.get('[data-cy=care-stop-edit]').click({ scrollBehavior: 'center' })
        cy.get('[data-cy=care-stop-reason]').select('Embarazo')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=care-stop-reason-name]').should('have.text', 'Embarazo')
        reasonId('Embarazo').then((embarazo) => stops().should((rows) => expect(rows.map((r) => r.reason_id)).to.deep.equal([embarazo])))

        // Cleared, then recorded again.
        cy.get('[data-cy=care-stop-edit]').click({ scrollBehavior: 'center' })
        cy.get('[data-cy=care-stop-clear]').click()
        cy.get('[data-cy=care-stop-current]').should('not.exist')
        stops().should('have.length', 0)
        cy.get('[data-cy=care-stop-edit]').should('contain.text', 'Record reason').click({ scrollBehavior: 'center' })
        cy.get('[data-cy=care-stop-reason]').select('Precio')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=care-stop-reason-name]').should('have.text', 'Precio')

        // Counted in Reports > Retention, for the period it was recorded in.
        cy.visit('/reports/retention')
        cy.get('[data-cy=retention]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=retention-stop-row]').should('have.length', 1)
        cy.get('[data-cy=retention-stop-reason]').should('have.text', 'Precio')
        cy.get('[data-cy=retention-stop-count]').should('have.text', '1')
      })
    })
  })
})
