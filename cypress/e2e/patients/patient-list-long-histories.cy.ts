// The patient list's Last visit and care-plan columns, for patients with a
// long history.
//
// They used to be worked out from every completed visit of every patient on
// the page, fetched as rows -- and PostgREST stops at 1000 rows without an
// error. So one patient with a long history pushed everyone else's visits
// past the cut: their Last visit read "Never", and the long-standing
// patient's plan progress stopped counting at 1000. The list now asks for one
// summary row per patient (patient_list_visit_summary).
describe('Patient list with long visit histories', () => {
  it('counts every visit, and a long history does not hide anyone else', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Antonia', lastName: 'Asidua' }).then((regular: any) => {
        // 1001 visits, all newer than the other patient's one -- so, ordered
        // newest first, that one visit would be row 1002.
        cy.task('db:seedCompletedVisits', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: regular.id,
          count: 1001,
          endingAt: '2026-06-30T10:00:00Z',
          carePlanVisits: 1200,
        })
      })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Beatriz', lastName: 'Esporadica' }).then((occasional: any) => {
        cy.task('db:seedCompletedVisits', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: occasional.id,
          count: 1,
          endingAt: '2020-03-15T10:00:00Z',
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')

      // Every visit counted, not the first thousand.
      cy.contains('tr', 'Antonia Asidua').should('contain.text', '1001/1200')
      // Her one visit is still found, although a thousand others are newer.
      cy.contains('tr', 'Beatriz Esporadica').should('contain.text', '2020').and('not.contain.text', 'Never')
    })
  })
})
