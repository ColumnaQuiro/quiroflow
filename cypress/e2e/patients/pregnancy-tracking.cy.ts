// A pregnancy on the patient's record: the due date is stored, weeks and the
// trimester are counted from it, and it shows beside the name on every tab.
// Anonymising the record clears it, like the rest of the clinical data.

function isoDaysFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('Pregnancy tracking', () => {
  it('is recorded on the Overview, counts the weeks, and ends', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucia', lastName: 'Espera' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.get('[data-cy=pregnancy-record]', { timeout: 15000 }).click()
        // 109 days to go: 280 - 109 = 171 days = 24 weeks + 3 days.
        cy.get('[data-cy=pregnancy-due-input]').type(isoDaysFromToday(109))
        cy.get('[data-cy=pregnancy-multiples]').select('Twins')
        cy.get('[data-cy=pregnancy-save]').click()

        cy.get('[data-cy=pregnancy-weeks]').should('have.text', '24+3 wk')
        cy.get('[data-cy=pregnancy-card]').should('contain.text', '2nd trimester').and('contain.text', 'Twins').and('contain.text', 'in 109 days')
        cy.get('[data-cy=banner-pregnancy]').should('contain.text', 'Pregnant · 24+3 wk')

        cy.get('[data-cy=pregnancy-edit]').click()
        cy.get('[data-cy=pregnancy-end]').click()
        cy.get('[data-cy=pregnancy-card]').should('not.exist')
        cy.get('[data-cy=banner-pregnancy]').should('not.exist')
        cy.task<{ pregnancy_due_date: string | null }[]>('db:selectRows', { table: 'patients', columns: 'pregnancy_due_date', match: { id: patient.id } })
          .its('0.pregnancy_due_date')
          .should('be.null')
      })
    })
  })

  it('is cleared when the record is anonymised', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Nima' }).then((patient) => {
        cy.task('db:updateRows', { table: 'patients', values: { pregnancy_due_date: isoDaysFromToday(60), pregnancy_multiples: 2, pregnancy_notes: 'Breech' }, match: { id: patient.id } })
        // The moment anonymize_patient marks: anonymized_at is set.
        cy.task('db:updateRows', { table: 'patients', values: { anonymized_at: new Date().toISOString() }, match: { id: patient.id } })
        cy.task('db:selectRows', { table: 'patients', columns: 'pregnancy_due_date, pregnancy_multiples, pregnancy_notes', match: { id: patient.id } }).should('deep.equal', [
          { pregnancy_due_date: null, pregnancy_multiples: null, pregnancy_notes: null },
        ])
      })
    })
  })
})
