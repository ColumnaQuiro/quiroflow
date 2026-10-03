// A patient's DNI/NIE is the recipient NIF on every full factura sent to the
// AEAT, and it was saved exactly as typed. "12.345.678-Z" is not NIF-shaped
// and faulted the whole VeriFactu envelope (4102); a wrong check letter was
// refused per record (1239). The form now stores the normalised form, refuses
// a check letter that cannot be right, and keeps -- but flags -- anything that
// is not a Spanish identifier at all.
function nationalIdOf(patientId: string) {
  return cy
    .task<any[]>('db:selectRows', { table: 'patients', columns: 'national_id', match: { id: patientId } })
    .then((rows) => rows[0]?.national_id ?? null)
}

// Scrolled to the centre: Cypress's default puts the field at the top, under
// the dialog's sticky header.
function typeId(value: string) {
  cy.get('[data-cy="patient-national-id"]').clear({ scrollBehavior: 'center' })
  cy.get('[data-cy="patient-national-id"]').type(value, { scrollBehavior: 'center' })
}

function openDetails(patientId: string) {
  cy.visit(`/patients/${patientId}`)
  cy.contains('button', 'Edit all details').click()
  cy.get('[data-cy="patient-national-id"]').should('be.visible')
}

describe('The patient’s national ID', () => {
  it('is stored in the form the AEAT reads, and a wrong check letter is refused', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Nif' }).then((patient: any) => {
        cy.login(account.email, account.password)

        // A wrong letter: refused before anything is written.
        openDetails(patient.id)
        typeId('12345678A')
        cy.get('[data-cy="patient-national-id-warning"]').should('contain', 'check letter')
        cy.contains('button', 'Save').click({ scrollBehavior: 'center' })
        cy.contains('the check letter does not match').should('be.visible')
        nationalIdOf(patient.id).should('eq', null)

        // Typed with dots, a dash and in lower case: saved as 12345678Z.
        typeId('12.345.678-z')
        cy.get('[data-cy="patient-national-id-warning"]').should('not.exist')
        cy.contains('button', 'Save').click({ scrollBehavior: 'center' })
        cy.contains('Patient saved').should('be.visible')
        nationalIdOf(patient.id).should('eq', '12345678Z')
      })
    })
  })

  it('keeps a foreign ID, and says it will not reach Hacienda as a NIF', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paul', lastName: 'Passport' }).then((patient: any) => {
        cy.login(account.email, account.password)
        openDetails(patient.id)
        typeId('AB1234567')
        cy.get('[data-cy="patient-national-id-warning"]').should('contain', 'Not a Spanish DNI/NIE/NIF')
        cy.contains('button', 'Save').click({ scrollBehavior: 'center' })
        cy.contains('Patient saved').should('be.visible')
        nationalIdOf(patient.id).should('eq', 'AB1234567')
      })
    })
  })
})
