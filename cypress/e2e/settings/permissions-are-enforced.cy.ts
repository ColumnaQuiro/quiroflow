import type { StaffAccount } from '../../support/commands'
import { todayAt } from '../../support/calendar'

// Six permissions that were stored, seeded into every account and shown in the
// roles editor while nothing read them (or read them only halfway). Each test
// here flips one on a real role and checks what that person can then see and
// do -- in the browser, and where the database is the guard, against the
// database directly with the browser's own key.

const PASSWORD = 'Test1234!'

function member(account: StaffAccount, roleName: string, fullName: string, isPractitioner = false) {
  const email = `${roleName.replace(/\s/g, '').toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
  // The owner already fills the plan's one included practitioner seat.
  if (isPractitioner) cy.setExtraProfessionals(account.accountId, 1)
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName, email, password: PASSWORD, fullName, isPractitioner })
    .then((m) => ({ email, teamMemberId: m.teamMemberId }))
}

function patient(account: StaffAccount, firstName: string, lastName: string) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
}

function appointment(account: StaffAccount, patientId: string, practitionerId: string, startsAt: string) {
  return cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId, startsAt })
}

// Later today, but never past midnight.
function soonToday(minutes: number) {
  const d = new Date(Date.now() + minutes * 60000)
  const cap = new Date()
  cap.setHours(23, 55, 0, 0)
  return (d < cap ? d : cap).toISOString()
}

describe('Permissions that are enforced', () => {
  it('reports_own_only: reports count only their own appointments, and the clinic-wide ones are not offered', () => {
    cy.seedStaffAccount().then((account) => {
      // calendar_scope 'all' so the database would hand them every
      // appointment: what narrows the report is reports_own_only alone.
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { calendar_scope: 'all', patients_scope: 'all', reports_access: true, reports_own_only: true } })
      member(account, 'Practitioner', 'Paula Propia', true).then((me) => {
        patient(account, 'Ana', 'Mia').then((p) => {
          appointment(account, p.id, me.teamMemberId, todayAt(9, 0))
          appointment(account, p.id, account.teamMemberId, todayAt(10, 0))
          appointment(account, p.id, account.teamMemberId, todayAt(11, 0))
        })

        cy.login(me.email, PASSWORD)
        cy.visit('/reports')
        cy.get('[data-cy=reports-own-only-note]').should('exist')
        cy.contains('a', 'Upcoming Visits').should('exist')
        cy.contains('a', 'Debtors').should('not.exist')
        cy.contains('a', 'Data Exports').should('not.exist')

        cy.visit('/reports/upcoming-visits')
        cy.contains('p', 'Total this month', { timeout: 20000 }).next().should('have.text', '1')

        cy.visit('/reports/appointment-distribution')
        cy.get('[data-cy=report-own-only]').should('exist')
        cy.get('[data-cy=report-practitioner-filter]').should('not.exist')

        // Typing the address is not a way round it.
        cy.visit('/reports/debtors')
        cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard')
        cy.contains("You don't have access to that section.").should('exist')

        // The owner is never narrowed, whatever their role says.
        cy.login(account.email, account.password)
        cy.visit('/reports/upcoming-visits')
        cy.contains('p', 'Total this month', { timeout: 20000 }).next().should('have.text', '3')
      })
    })
  })

  it('dashboard_scope: "own" shows only their own figures, "none" shows none', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { calendar_scope: 'all', patients_scope: 'all', dashboard_scope: 'own' } })
      member(account, 'Practitioner', 'Paula Propia', true).then((me) => {
        patient(account, 'Ana', 'Mia').then((p) => appointment(account, p.id, me.teamMemberId, soonToday(20)))
        patient(account, 'Oscar', 'Ajeno').then((p) => appointment(account, p.id, account.teamMemberId, soonToday(25)))

        cy.login(me.email, PASSWORD)
        cy.visit('/dashboard')
        cy.get('[data-cy=report-own-only]').should('exist')
        cy.contains('Next up today').parents('[class*=rounded-card]').first().within(() => {
          cy.contains('Ana Mia').should('exist')
          cy.contains('Oscar Ajeno').should('not.exist')
        })
        // Money owed on bonos is the clinic's, and cannot be narrowed to one person.
        cy.contains('Debtors').should('not.exist')

        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { dashboard_scope: 'none' } })
        cy.visit('/dashboard')
        cy.get('[data-cy=dashboard-none]').should('contain.text', 'No figures on your dashboard')
        cy.contains('Next up today').should('not.exist')
      })
    })
  })

  it('packages_edit: selling a bono needs it, and the database agrees', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 5', sessionCount: 5, priceCents: 20000 })
      member(account, 'Front Desk', 'Fran Frontdesk').then((me) => {
        patient(account, 'Bea', 'Bono').then((p) => {
          // Front Desk has billing_access but neither billing_config nor packages_edit.
          cy.login(me.email, PASSWORD)
          cy.visit(`/patients/${p.id}?tab=money`)
          cy.get('[data-cy=packages-empty]', { timeout: 20000 }).should('contain.text', 'Your role does not include selling or editing bonos')
          cy.get('[data-cy=sell-package-form]').should('not.exist')
          cy.task('db:writeAsStaff', {
            email: me.email,
            password: PASSWORD,
            op: 'insertPackagePurchase',
            purchase: { account_id: account.accountId, patient_id: p.id, package_name: 'Bono 5', sessions_total: 5, price_cents: 20000, owed_cents: 20000 },
          }).its('error').should('match', /row-level security/)

          cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { packages_edit: true } })
          cy.reload()
          // By value: the label's price carries formatEur's non-breaking space.
          cy.get('[data-cy=sell-package-form] select', { timeout: 20000 })
            .first()
            .contains('option', 'Bono 5')
            .invoke('attr', 'value')
            .then((value) => cy.get('[data-cy=sell-package-form] select').first().select(value!))
          cy.get('[data-cy=sell-package-form]').contains('button', /^Sell$/).click()
          cy.contains('button', 'Selling…').should('not.exist')
          cy.task('db:packagePurchasesFor', { patientId: p.id }).then((rows: any) => {
            expect(rows).to.have.length(1)
            expect(rows[0].package_name).to.eq('Bono 5')
            expect(rows[0].created_by).to.eq(me.teamMemberId)
          })
        })
      })
    })
  })

  it('billing_history_view: without it the Money tab is not there', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { billing_history_view: false } })
      member(account, 'Front Desk', 'Fran Frontdesk').then((me) => {
        patient(account, 'Hugo', 'Historial').then((p) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: p.id, totalCents: 4500, status: 'unpaid' })
          cy.login(me.email, PASSWORD)
          cy.visit(`/patients/${p.id}?tab=money`)
          // By id: "Money" is also the sidebar's section heading.
          cy.get('#tab-overview', { timeout: 20000 }).should('exist')
          cy.get('#tab-money').should('not.exist')
          cy.contains('Account Ledger').should('not.exist')

          cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { billing_history_view: true } })
          cy.reload()
          cy.get('#tab-money', { timeout: 20000 }).should('exist')
        })
      })
    })
  })

  it('patients_tags_remove: a bono or membership tag stays, other tags come off', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 10', sessionCount: 10, priceCents: 40000 })
      cy.task('db:createMembershipTemplate', { accountId: account.accountId, name: 'Plan Mensual' })
      member(account, 'Front Desk', 'Fran Frontdesk').then((me) => {
        patient(account, 'Tomás', 'Tags').then((p) => {
          cy.task('db:setPatientTags', { patientId: p.id, tags: ['Bono 10', 'plan mensual', 'VIP'] })
          cy.login(me.email, PASSWORD)
          cy.visit(`/patients/${p.id}?tab=clinical`)
          cy.contains('button', 'Edit clinical details', { timeout: 20000 }).click()
          cy.contains('p', 'Flags').parent().contains('button', /^Edit$/).click()
          cy.get('[data-cy=patient-tag][data-tag="Bono 10"] [data-cy=patient-tag-remove]').should('not.exist')
          cy.get('[data-cy=patient-tag][data-tag="Bono 10"] [data-cy=patient-tag-locked]').should('exist')
          cy.get('[data-cy=patient-tag][data-tag="plan mensual"] [data-cy=patient-tag-remove]').should('not.exist')
          cy.get('[data-cy=patient-tag][data-tag="VIP"] [data-cy=patient-tag-remove]').click()
          cy.task('db:patientTags', { patientId: p.id }).should('deep.equal', ['Bono 10', 'plan mensual'])

          // The database refuses it directly too.
          cy.task('db:writeAsStaff', { email: me.email, password: PASSWORD, op: 'setPatientTags', patientId: p.id, tags: ['plan mensual'] })
            .its('error')
            .should('contain', 'cannot remove bono or membership tags')
          cy.task('db:patientTags', { patientId: p.id }).should('deep.equal', ['Bono 10', 'plan mensual'])

          cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { patients_tags_remove: true } })
          cy.task('db:writeAsStaff', { email: me.email, password: PASSWORD, op: 'setPatientTags', patientId: p.id, tags: [] }).its('error').should('eq', null)
          cy.task('db:patientTags', { patientId: p.id }).should('deep.equal', [])
        })
      })
    })
  })

  it('calendar_read_only: no controls to change anything, and the database refuses a delete', () => {
    cy.seedStaffAccount().then((account) => {
      // appointments_delete stays on: read-only has to win over it.
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { calendar_read_only: true, appointments_delete: true } })
      member(account, 'Front Desk', 'Fran Frontdesk').then((me) => {
        patient(account, 'Rita', 'Lectura').then((p) => {
          appointment(account, p.id, account.teamMemberId, todayAt(12, 0)).then((appt) => {
            cy.login(me.email, PASSWORD)
            cy.visit('/calendar')
            cy.get('[data-cy=calendar-read-only]', { timeout: 20000 }).should('exist')
            cy.contains('select', 'Work week').select('day')
            cy.get('[data-cy=new-appointment]').should('not.exist')
            cy.contains('[data-cy=appt-block]', 'Rita Lectura', { timeout: 20000 }).click()
            cy.get('[data-cy=appt-sheet]').within(() => {
              cy.get('[data-cy=appt-read-only]').should('exist')
              cy.get('[data-cy=appt-edit]').should('not.exist')
              cy.get('[data-cy=cancel-appointment]').should('not.exist')
              cy.get('[data-cy=move-appointment]').should('not.exist')
              cy.get('[data-cy=advance-stage]').should('not.exist')
              cy.get('[data-cy=delete-appointment]').should('not.exist')
            })

            cy.task('db:writeAsStaff', { email: me.email, password: PASSWORD, op: 'deleteAppointment', appointmentId: appt.id }).its('rows').should('eq', 0)
            cy.task('db:writeAsStaff', { email: me.email, password: PASSWORD, op: 'softDeleteAppointment', appointmentId: appt.id }).its('rows').should('eq', 0)
            cy.task('db:appointmentById', { appointmentId: appt.id }).its('deleted_at').should('eq', null)
          })
        })
      })
    })
  })

  it('appointments_delete: the panel\'s delete needs it, and so does the database', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { calendar_scope: 'all', patients_scope: 'all', appointments_delete: false } })
      member(account, 'Practitioner', 'Paula Propia', true).then((me) => {
        patient(account, 'Dani', 'Borrado').then((p) => {
          appointment(account, p.id, me.teamMemberId, todayAt(12, 0)).then((appt) => {
            cy.login(me.email, PASSWORD)
            cy.visit('/calendar')
            cy.contains('select', 'Work week', { timeout: 20000 }).select('day')
            cy.contains('[data-cy=appt-block]', 'Dani Borrado', { timeout: 20000 }).click()
            cy.get('[data-cy=appt-sheet]').within(() => {
              cy.get('[data-cy=appt-edit]').should('exist')
              cy.get('[data-cy=delete-appointment]').should('not.exist')
            })
            cy.task('db:writeAsStaff', { email: me.email, password: PASSWORD, op: 'softDeleteAppointment', appointmentId: appt.id })
              .its('error')
              .should('contain', 'cannot delete appointments')
            cy.task('db:appointmentById', { appointmentId: appt.id }).its('deleted_at').should('eq', null)
          })
        })
      })
    })
  })
})
