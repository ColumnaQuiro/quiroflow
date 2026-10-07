// The low-severity findings of the settings QA round (30 Sep 2026).

describe('Settings QA: low-severity fixes', () => {
  it('lists a part-day clinic block with its hours, and asks before reopening', () => {
    cy.seedStaffAccount().then((account) => {
      // Tomorrow 10:00-12:00 UTC, clinic-wide, as the calendar draws a block.
      const day = new Date(Date.now() + 86400000)
      const at = (h: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h)).toISOString()
      cy.task('db:settingsWriteAsStaff', {
        email: account.email,
        password: account.password,
        table: 'availability_blocks',
        op: 'insert',
        values: { account_id: account.accountId, clinic_id: account.clinicId, starts_at: at(10), ends_at: at(12), note: 'Reunión' },
      })
      cy.login(account.email, account.password)
      cy.visit(`/settings/clinics/${account.clinicId}`)
      cy.get('[data-cy=clinic-closure]').scrollIntoView().invoke('text').should('match', /\d{2}:\d{2}–\d{2}:\d{2}/)
      cy.get('[data-cy=clinic-closure-remove]').click()
      cy.get('[data-cy=confirm-dialog]').contains('button', 'Cancel').click()
      cy.get('[data-cy=clinic-closure]').should('exist')
    })
  })

  it('does not ask to leave an appointment type when the same duration is typed back', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 }).then((type) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-page]')
        cy.get('[data-cy=type-duration]').clear().type('30')
        cy.get('[data-cy=type-back]').click()
        cy.location('pathname').should('eq', '/settings/appointment-types')
      })
    })
  })

  it('refuses to delete a plan an automation filters on, naming it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createMembershipTemplate', { accountId: account.accountId, name: 'Plan mensual' }).then((plan) => {
        cy.task('db:createAutomationRule', {
          accountId: account.accountId,
          triggerEvent: 'appointment.completed',
          name: 'Gracias a los socios',
          filters: { membership_active: true, membership_ids: [plan.id] },
          actions: [{ type: 'tag', config: { tag: 'socio' } }],
        })
        cy.login(account.email, account.password)
        cy.visit('/settings/memberships')
        cy.contains('[data-cy=membership-row]', 'Plan mensual').find('[data-cy=membership-edit]').click()
        cy.get('[data-cy=membership-remove]').click()
        cy.contains('Gracias a los socios').should('be.visible')
        cy.contains('[data-cy=membership-row]', 'Plan mensual').should('exist')
      })
    })
  })

  it('keeps a member on the period they signed up on when the plan changes', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createMembershipTemplate', { accountId: account.accountId, name: 'Plan', priceCents: 4000 }).then((plan) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
          const asOwner = { email: account.email, password: account.password }
          cy.task('db:settingsWriteAsStaff', {
            ...asOwner,
            table: 'patient_memberships',
            op: 'insert',
            values: { account_id: account.accountId, patient_id: p.id, membership_id: plan.id, membership_name: 'Plan', price_cents: 4000 },
          })
          cy.task('db:settingsWriteAsStaff', { ...asOwner, table: 'memberships', op: 'update', values: { billing_interval: 'year' }, match: { id: plan.id } })
          cy.task<any[]>('db:selectRows', { table: 'patient_memberships', columns: 'billing_interval, billing_interval_count', match: { patient_id: p.id } })
            .its(0)
            .should('deep.equal', { billing_interval: 'month', billing_interval_count: 1 })
        })
      })
    })
  })

  it('saves the staff alert WhatsApp in international form, and refuses an email that is not one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/leads')
      cy.get('[data-cy="leads-settings"][data-ready="true"]')
      cy.get('[data-cy="lead-notify-email"]').clear().type('recepcion')
      cy.get('[data-cy="lead-notify-whatsapp"]').clear().type('600 111 222')
      cy.get('[data-test="save-lead-settings"]').click()
      cy.contains('not an email address').should('be.visible')
      cy.get('[data-cy="lead-notify-email"]').clear().type('recepcion@clinica.es')
      cy.get('[data-test="save-lead-settings"]').click()
      cy.get('[data-cy="lead-notify-whatsapp"]').should('have.value', '+34600111222')
      cy.task<any[]>('db:selectRows', { table: 'accounts', columns: 'new_lead_notify_whatsapp', match: { id: account.accountId } })
        .its('0.new_lead_notify_whatsapp')
        .should('eq', '+34600111222')
    })
  })

  it('creates one saved reply however fast New reply is pressed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/saved-replies')
      cy.get('[data-cy="replies-settings"][data-ready="true"]')
      cy.get('[data-cy="reply-new"]').dblclick()
      cy.get('[data-cy="reply-row"]').should('have.length', 1)
      cy.task<any[]>('db:selectRows', { table: 'saved_replies', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 1)
    })
  })
})
