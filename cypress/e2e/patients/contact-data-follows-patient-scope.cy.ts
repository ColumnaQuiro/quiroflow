import type { StaffAccount } from '../../support/commands'

// A practitioner whose role sees only their own patients ('own' patients
// scope) could still read every patient's phone numbers, care plans, emails,
// waitlist places and recall contact history straight from the API: those
// five tables were gated on account membership alone, so the scoping the
// patients table does stopped at the patients table. Each now follows the same
// rule as the patient it belongs to -- what you can read of a person is what
// you can read of their record.
//
// Asked with the browser's own key and session, so what is tested is the
// policy, not what a page happens to show.

const PASSWORD = 'Test1234!'
const TABLES = ['patient_contact_numbers', 'care_plans', 'email_messages', 'waitlist_entries', 'contact_log'] as const

function member(account: StaffAccount, roleName: string, label: string) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName, email, password: PASSWORD, fullName: label })
    .then((m) => ({ email, password: PASSWORD, teamMemberId: m.teamMemberId }))
}

function seedPatientData(account: StaffAccount, patientId: string, label: string) {
  const base = { account_id: account.accountId, patient_id: patientId }
  cy.task('db:insertRows', { table: 'care_plans', rows: [{ ...base, name: `Plan ${label}`, frequency_value: 2, frequency_unit: 'week', total_visits: 6 }] })
  cy.task('db:insertRows', { table: 'contact_log', rows: [{ ...base, action: 'called_no_answer' }] })
  cy.task('db:insertRows', { table: 'email_messages', rows: [{ ...base, recipient_email: `${label}@example.test`, subject: 'Hola', provider_message_id: `test-${label}-${Date.now()}` }] })
  cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId })
}

function visiblePatients(who: { email: string; password: string }, table: string, ids: string[]) {
  return cy
    .task<{ rows: { patient_id: string }[]; error: string | null }>('db:selectAsStaff', { email: who.email, password: who.password, table, columns: 'patient_id', inColumn: 'patient_id', inValues: ids })
    .then((r) => {
      expect(r.error, `${table} read`).to.eq(null)
      return [...new Set(r.rows.map((row) => row.patient_id))].sort()
    })
}

describe("A patient's contact data follows who may see the patient", () => {
  it('shows an own-scope practitioner only their own patients, and everyone else all of them', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, 'Practitioner', 'Prac').then((prac) => {
        member(account, 'Front Desk', 'Desk').then((desk) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mia', lastName: 'Suya', phone: '600111222', defaultPractitionerId: prac.teamMemberId }).then((mine) => {
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Otra', lastName: 'Ajena', phone: '600333444' }).then((other) => {
              seedPatientData(account, mine.id, 'mine')
              seedPatientData(account, other.id, 'other')
              const both = [mine.id, other.id].sort()

              for (const table of TABLES) {
                visiblePatients(prac, table, both).should('deep.equal', [mine.id])
                visiblePatients(desk, table, both).should('deep.equal', both)
                visiblePatients(account, table, both).should('deep.equal', both)
              }

              // Writes follow the same line: a number for their own patient
              // goes in, one for somebody else's is refused.
              cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
                email: prac.email,
                password: prac.password,
                table: 'patient_contact_numbers',
                op: 'insert',
                values: { account_id: account.accountId, patient_id: mine.id, country_code: 'ES', number: '611000111' },
              }).then((r) => {
                expect(r.error, 'own patient').to.eq(null)
                expect(r.changed).to.eq(1)
              })
              cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
                email: prac.email,
                password: prac.password,
                table: 'patient_contact_numbers',
                op: 'insert',
                values: { account_id: account.accountId, patient_id: other.id, country_code: 'ES', number: '611000222' },
              }).its('error').should('match', /row-level security/)
              cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
                email: prac.email,
                password: prac.password,
                table: 'care_plans',
                op: 'update',
                values: { name: 'Cambiado' },
                match: { patient_id: other.id },
              }).its('changed').should('eq', 0)
              cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
                email: desk.email,
                password: desk.password,
                table: 'patient_contact_numbers',
                op: 'insert',
                values: { account_id: account.accountId, patient_id: other.id, country_code: 'ES', number: '611000333' },
              }).its('changed').should('eq', 1)

              // Cancelling a visit still finds who is waiting for the slot,
              // without naming patients the practitioner cannot open: the
              // waitlist's shape comes back, not its patients.
              cy.task<{ data: Record<string, unknown>[] | null; error: string | null }>('db:rpcAsStaff', {
                email: prac.email,
                password: prac.password,
                fn: 'waitlist_waiting_in_clinic',
                args: { p_clinic_id: account.clinicId },
              }).then((r) => {
                expect(r.error).to.eq(null)
                expect(r.data, 'both waiting entries').to.have.length(2)
                expect(Object.keys(r.data![0]).sort()).to.deep.equal(['appointment_type_id', 'appointment_type_name', 'created_at', 'id', 'practitioner_id', 'practitioner_name'])
              })
            })
          })
        })
      })
    })
  })

  it('lets an own-scope practitioner see a slot of theirs held for someone on the waitlist', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, 'Practitioner', 'Prac').then((prac) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Espera', lastName: 'Ajena' }).then((other) => {
          const startsAt = new Date(Date.now() + 2 * 86400000).toISOString()
          const endsAt = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString()
          cy.task('db:createWaitlistEntry', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: other.id,
            status: 'offered',
            offered: { startsAt, endsAt, roomId: null, practitionerId: prac.teamMemberId, expiresAt: new Date(Date.now() + 3600000).toISOString() },
          })
          visiblePatients(prac, 'waitlist_entries', [other.id]).should('deep.equal', [other.id])
        })
      })
    })
  })
})
