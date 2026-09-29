// Settings > Services & Products, New Patient Fields and Scheduling
// Policies, redesigned together -- and Modalities, which left the menu
// because nothing in QuiroFlow read it.

describe('Services, new patient fields and scheduling policies', () => {
  it('no longer offers Modalities, and its old address lands on Settings', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/modalities')
      cy.location('pathname').should('eq', '/settings')
      cy.contains('a', 'Modalities').should('not.exist')
    })
  })

  it('edits a service in place, and only lets one nobody was charged for be deleted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createServiceProduct', { accountId: account.accountId, name: 'Radiografía', priceCents: 4500 }).then((used) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sara' }).then((patient: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4500, status: 'unpaid' }).then((inv: any) => {
            cy.task('db:chargeService', { accountId: account.accountId, invoiceId: inv.id, serviceId: used.id, priceCents: 4500 })
          })
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/settings/services')
      cy.get('[data-cy="services-settings"][data-ready="true"]')
      // The account-wide IVA rule, said once, in place of a per-service field
      // nothing read.
      cy.get('[data-cy="services-tax-line"]').should('contain', 'IVA')

      cy.get('[data-cy="service-new-name"]').type('Informe clínico')
      cy.get('[data-cy="service-new-price"]').type('35,00')
      cy.get('[data-cy="service-new-save"]').click()
      cy.contains('[data-cy="service-row"]', 'Informe clínico').as('fresh')
      cy.get('@fresh').find('[data-cy="service-price"]').should('contain', '35,00')

      cy.get('@fresh').find('[data-cy="service-edit"]').click()
      cy.get('[data-cy="service-edit-price"]').clear().type('40,00')
      cy.get('[data-cy="service-edit-save"]').click()
      cy.contains('[data-cy="service-row"]', 'Informe clínico').find('[data-cy="service-price"]').should('contain', '40,00')

      cy.contains('[data-cy="service-row"]', 'Radiografía').as('used')
      cy.get('@used').find('[data-cy="service-uses"]').should('have.text', 'Charged once')
      cy.get('@used').find('[data-cy="service-delete"]').should('not.exist')

      cy.contains('[data-cy="service-row"]', 'Informe clínico').find('[data-cy="service-delete"]').click()
      cy.contains('[data-cy="service-name"]', 'Informe clínico').should('not.exist')
    })
  })

  it('stores a field as hidden, optional or required, and never "hidden but required"', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/new-patient-fields')
      cy.get('[data-cy="fields-settings"][data-ready="true"]')

      cy.get('[data-field="phone"] [data-cy="field-required"]').click()
      cy.get('[data-field="occupation"] [data-cy="field-hidden"]').click()
      // Always has a value, so it cannot be required.
      cy.get('[data-field="preferred_language"] [data-cy="field-required"]').should('be.disabled')

      cy.get('[data-cy="fields-preview"]').should('contain', 'Phone number *').and('not.contain', 'Occupation')
      cy.get('[data-cy="fields-save"]').click()
      cy.wait('@saveAccount').then(({ request }) => {
        const config = request.body.new_patient_field_config
        expect(config.phone).to.deep.eq({ visible: true, required: true })
        expect(config.occupation).to.deep.eq({ visible: false, required: false })
      })
    })
  })

  it('offers a fee only while it is switched on, and forgets the amount when off', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/reschedule-reasons')
      cy.get('[data-cy="policies-settings"][data-ready="true"]')

      cy.get('[data-fee="cancellation_fee_cents"] [data-cy="fee-switch"]').click()
      // On with no amount is refused, rather than saved as a free fee.
      cy.get('[data-cy="fees-save"]').click()
      cy.get('[data-cy="fee-error"]').should('be.visible')

      cy.get('[data-fee="cancellation_fee_cents"] [data-cy="fee-amount"]').type('25,00')
      cy.get('[data-cy="fees-save"]').click()
      cy.wait('@saveAccount').its('request.body').should('deep.include', { cancellation_fee_cents: 2500, missed_appointment_fee_cents: null, scheduling_policy_fee_cents: null })
    })
  })

  it('adds a reschedule reason, and says what deleting one does', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/reschedule-reasons')
      cy.get('[data-cy="policies-settings"][data-ready="true"]')

      cy.get('[data-cy="reason-new-name"]').type('Clínica cerrada')
      cy.get('[data-cy="reason-new-save"]').click()
      cy.contains('[data-cy="reason-row"]', 'Clínica cerrada').find('[data-cy="reason-uses"]').should('have.text', 'Not used yet')

      cy.contains('[data-cy="reason-row"]', 'Clínica cerrada').find('[data-cy="reason-delete"]').click()
      cy.get('[data-cy="confirm-dialog"]').should('contain', 'show no reason').contains('button', 'Delete reason').click()
      cy.contains('[data-cy="reason-name"]', 'Clínica cerrada').should('not.exist')
    })
  })
})
