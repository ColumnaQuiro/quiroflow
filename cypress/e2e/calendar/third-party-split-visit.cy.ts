import { todayAt } from '../../support/calendar'

// A visit split between a mutua and the patient (20261023093754).
//
// Sanitas pays 35 EUR of a 45 EUR physiotherapy session and the patient pays a
// 10 EUR copago. What the patient owes must be the 10 and nothing else -- on
// the visit's receipt, in "Owed now", in patient_live_balances -- and the 35
// must be owed by Sanitas, until Sanitas pays it. The patient's figures do not
// move when it does.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function yesterdayIso() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// formatEur writes a no-break space before the euro sign.
const amount = (expected: string) => ($el: JQuery<HTMLElement>) => expect($el.text().replace(/\s/g, ' ').trim()).to.eq(expected)

function patientOwes(patientId: string) {
  return cy
    .task<{ outstanding_cents: number; balance_cents: number }[]>('db:selectRows', {
      table: 'patient_live_balances',
      columns: 'outstanding_cents, balance_cents',
      match: { patient_id: patientId },
    })
    .then((rows) => rows[0])
}

describe('A visit billed to a third party', () => {
  it('leaves the patient owing only their copago and the third party the rest', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Fisioterapia', durationMinutes: 45, defaultPriceCents: 4500 }).then((type) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Mutualista' }).then((patient) => {
          cy.task<{ id: string }[]>('db:insertRows', { table: 'third_parties', rows: [{ account_id: account.accountId, name: 'Sanitas', kind: 'insurer', tax_id: 'A28037224' }] }).then(([sanitas]) => {
            // Ten sessions authorised -- but the authorisation ran out yesterday.
            cy.task('db:insertRows', {
              table: 'patient_third_parties',
              rows: [{ account_id: account.accountId, patient_id: patient.id, third_party_id: sanitas.id, policy_number: 'POL-123', authorized_sessions: 10, valid_until: yesterdayIso() }],
            })
            // Checked in, so billable whatever time of day the spec runs.
            cy.task('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              appointmentTypeId: type.id,
              startsAt: todayAt(10, 0),
              durationMinutes: 45,
              checkedIn: true,
            })

            cy.login(account.email, account.password)
            cy.visit('/calendar')
            cy.contains('select', 'Work week').select('day')
            cy.contains('[data-cy=appt-block]', 'Lucía Mutualista').click()

            cy.get('[data-cy=appt-sheet]').within(() => {
              cy.get('[data-cy=appt-tab-billing]').click()
              cy.contains('Not charged yet').should('be.visible')
              cy.get('[data-cy=tp-visit-start]').click()
              // The patient's own cover comes first, with its policy and use.
              cy.get('[data-cy=tp-visit-payer] option:selected').should('contain.text', 'Sanitas').and('contain.text', 'POL-123').and('contain.text', '0/10')
              cy.contains('[data-cy=tp-visit-warning]', 'Authorisation expired').should('be.visible')
              // No rate for this type: the third party is offered the visit's price.
              cy.get('[data-cy=tp-visit-tp-amount]').should('have.value', '45.00').clear().type('35')
              cy.get('[data-cy=tp-visit-patient-amount]').clear().type('10')
              cy.get('[data-cy=tp-visit-save]').click()

              // The receipt is the patient's share, and says who pays the rest.
              cy.contains('Fisioterapia · copago Sanitas').should('be.visible')
              cy.contains('Total: 10,00 €').should('be.visible')
              cy.contains('Balance due: 10,00 €').should('be.visible')
              cy.get('[data-cy=tp-visit-charge-amount]').should(amount('35,00 €'))
              cy.get('[data-cy=tp-visit-start]').should('not.exist')
            })

            patientOwes(patient.id).then((row) => {
              expect(row.outstanding_cents, 'the patient owes their copago').to.eq(1000)
              expect(row.balance_cents, "and the balance carries nothing of Sanitas's").to.eq(-1000)
            })
            cy.task<{ amount_cents: number; status: string; policy_number: string; service_date: string }[]>('db:selectRows', {
              table: 'third_party_charges',
              columns: 'amount_cents, status, policy_number, service_date',
              match: { patient_id: patient.id },
            }).then((rows) => {
              expect(rows).to.have.length(1)
              expect(rows[0]).to.include({ amount_cents: 3500, status: 'pending', policy_number: 'POL-123' })
            })

            // The patient record: 10 owed by her, 35 by Sanitas, kept apart.
            cy.visit(`/patients/${patient.id}?tab=money`)
            cy.get('section[aria-labelledby=money-owed]').should('contain.text', '10,00')
            cy.get('[data-cy=patient-third-parties]').within(() => {
              cy.get('[data-cy=patient-tp-sessions]').should('contain.text', '1 of 10 sessions')
              cy.contains('[data-cy=patient-tp-warning]', 'Authorisation expired').should('be.visible')
              cy.contains('[data-cy=patient-tp-owed]', 'Owed by Sanitas').should('be.visible')
              cy.contains('[data-cy=patient-tp-owed]', '35,00 €').should('be.visible')
            })

            // What third parties owe.
            cy.visit('/billing/third-parties')
            cy.get('[data-cy=tp-aged][data-ready=true]')
            cy.contains('[data-cy=tp-aged-row]', 'Sanitas').find('[data-cy=tp-aged-row-total]').should(amount('35,00 €'))
            cy.contains('[data-cy=tp-aged-name]', 'Sanitas').click()

            // The statement names the visit under the policy it was billed on.
            cy.get('[data-cy=tp-detail][data-ready=true]')
            cy.get('[data-cy=tp-statement-link]')
              .invoke('attr', 'href')
              .then((href) => {
                const today = new Date()
                const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
                cy.visit(String(href).replace(/from=[^&]*/, `from=${iso}`).replace(/to=[^&]*/, `to=${iso}`))
                cy.get('[data-cy=tp-statement][data-ready=true]')
                cy.get('[data-cy=tp-statement-row]').should('have.length', 1).and('contain.text', 'POL-123').and('contain.text', 'Lucía Mutualista')
                cy.get('[data-cy=tp-statement-total]').should(amount('35,00 €'))
                cy.go('back')
              })

            // Sanitas pays.
            cy.get('[data-cy=tp-detail][data-ready=true]')
            cy.get('[data-cy=tp-detail-owed]').should(amount('35,00 €'))
            cy.get('[data-cy=tp-record-payment]').click()
            cy.get('[data-cy=tp-payment-amount]').type('35')
            cy.get('[data-cy=tp-payment-line]').should('have.length', 1).find('input').should('have.value', '35.00')
            cy.get('[data-cy=tp-payment-save]').click()
            cy.get('[data-cy=tp-payment-form]').should('not.exist')
            cy.get('[data-cy=tp-detail-owed]').should(amount('0,00 €'))
            cy.get('[data-cy=tp-payment-row]').should('have.length', 1)
            cy.contains('[data-cy=tp-payment-row]', '35,00 € applied to visits').should('be.visible')

            // And the patient still owes exactly her copago -- not a cent of it
            // moved with the insurer's money.
            patientOwes(patient.id).then((row) => {
              expect(row.outstanding_cents).to.eq(1000)
              expect(row.balance_cents).to.eq(-1000)
            })
          })
        })
      })
    })
  })

  it('a visit the third party pays in full is settled for the patient', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Fisioterapia', durationMinutes: 45, defaultPriceCents: 4500 }).then((type) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mario', lastName: 'Laboral' }).then((patient) => {
          cy.task<{ id: string }[]>('db:insertRows', { table: 'third_parties', rows: [{ account_id: account.accountId, name: 'Mutua Laboral', kind: 'medico_legal' }] }).then(([mutua]) => {
            // The mutua's agreed rate for this type: 28 EUR, nothing from the patient.
            cy.task('db:insertRows', { table: 'third_party_rates', rows: [{ account_id: account.accountId, third_party_id: mutua.id, appointment_type_id: type.id, pays_cents: 2800, copay_cents: 0 }] })
            cy.task<{ id: string }>('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              appointmentTypeId: type.id,
              startsAt: todayAt(10, 0),
              durationMinutes: 45,
              checkedIn: true,
            }).then((appt) => {
              cy.login(account.email, account.password)
              cy.visit('/calendar')
              cy.contains('select', 'Work week').select('day')
              cy.contains('[data-cy=appt-block]', 'Mario Laboral').click()

              cy.get('[data-cy=appt-sheet]').within(() => {
                cy.get('[data-cy=appt-tab-billing]').click()
                cy.get('[data-cy=tp-visit-start]').click()
                // No cover on file: any active third party can still be billed.
                cy.get('[data-cy=tp-visit-payer] option:selected').should('have.text', 'Mutua Laboral')
                cy.get('[data-cy=tp-visit-tp-amount]').should('have.value', '28.00')
                cy.get('[data-cy=tp-visit-patient-amount]').should('have.value', '0.00')
                cy.get('[data-cy=tp-visit-save]').click()
                cy.contains('Fisioterapia · a cargo de Mutua Laboral').should('be.visible')
                cy.get('[data-cy=tp-visit-charge-amount]').should(amount('28,00 €'))
                // Nothing for the patient to pay, so the receipt settles itself.
                cy.contains('a', 'INV-').parent().find('span').first().invoke('text').should((s) => expect(s.trim()).to.eq('paid'))
              })

              cy.task<{ status: string; total_cents: number }[]>('db:invoicesForAppointment', { appointmentId: appt.id }).should((rows) => {
                expect(rows).to.have.length(1)
                expect(rows[0]).to.include({ status: 'paid', total_cents: 0 })
              })
              patientOwes(patient.id).then((row) => {
                expect(row.outstanding_cents).to.eq(0)
                expect(row.balance_cents).to.eq(0)
              })
            })
          })
        })
      })
    })
  })
})
