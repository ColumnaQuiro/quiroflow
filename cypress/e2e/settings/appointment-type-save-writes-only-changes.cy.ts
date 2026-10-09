// Settings > Appointment types > one type: Save writes the columns that were
// edited and nothing else.
//
// It used to send the whole form, and wrote the deposit as null whenever
// payment at booking was off. So renaming a type whose deposit was kept while
// payment was off -- or while online booking was off -- deleted the deposit,
// and turning payment back on later started from nothing.
describe('Settings > Appointment types > type: Save writes only what changed', () => {
  function seedType(rules: { online: boolean; paymentRequired: boolean; depositCents: number }) {
    return cy.seedStaffAccount().then((account) =>
      cy
        .task<{ id: string }>('db:createAppointmentType', {
          accountId: account.accountId,
          name: 'Primera visita',
          durationMinutes: 45,
          defaultPriceCents: 5000,
          onlineBookingEnabled: rules.online,
        })
        .then((type) =>
          cy
            .task('db:setAppointmentTypeBookingRules', { id: type.id, paymentRequired: rules.paymentRequired, depositCents: rules.depositCents })
            .then(() => cy.task<{ row: any }>('db:appointmentTypeRow', { id: type.id }))
            .then(({ row }) => ({ account, typeId: type.id, before: row })),
        ),
    )
  }

  function openType(id: string) {
    cy.visit(`/settings/appointment-types/${id}`)
    cy.get('[data-cy=type-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
  }

  function changedColumns(typeId: string) {
    // Only staff edits: the seeding writes as the server.
    return cy
      .task<any[]>('db:auditLogFor', { entityId: typeId })
      .then((rows) => rows.filter((r) => r.entity_type === 'appointment_type' && r.action === 'updated' && r.actor === 'staff').map((r) => Object.keys(r.changes ?? {}).sort()))
  }

  function rename(typeId: string, before: any) {
    cy.get('[data-cy=type-save-bar]').should('not.exist')
    cy.get('[data-cy=type-name]').clear().type('Primera visita larga')
    cy.get('[data-cy=type-save]').click()
    cy.get('[data-cy=type-save-bar]').should('not.exist')

    cy.task<{ row: any }>('db:appointmentTypeRow', { id: typeId }).then(({ row }) => {
      expect(row.name).to.eq('Primera visita larga')
      expect(row.online_deposit_cents).to.eq(2000)
      expect({ ...row, name: before.name }).to.deep.eq(before)
    })
    changedColumns(typeId).should('deep.eq', [['name']])
  }

  it('renaming a type keeps a deposit stored while payment is off', () => {
    seedType({ online: true, paymentRequired: false, depositCents: 2000 }).then(({ account, typeId, before }) => {
      expect(before.online_deposit_cents).to.eq(2000)
      cy.login(account.email, account.password)
      openType(typeId)
      cy.get('[data-cy=type-payment]').should('have.attr', 'aria-checked', 'false')
      rename(typeId, before)
    })
  })

  it('renaming a type keeps a deposit stored while online booking is off', () => {
    seedType({ online: false, paymentRequired: true, depositCents: 2000 }).then(({ account, typeId, before }) => {
      cy.login(account.email, account.password)
      openType(typeId)
      cy.get('[data-cy=type-online]').should('have.attr', 'aria-checked', 'false')
      rename(typeId, before)
    })
  })

  it('turning payment off still clears the deposit', () => {
    seedType({ online: true, paymentRequired: true, depositCents: 2000 }).then(({ account, typeId }) => {
      cy.login(account.email, account.password)
      openType(typeId)
      cy.get('[data-cy=type-deposit]').should('have.value', '20,00')
      cy.get('[data-cy=type-payment]').click().should('have.attr', 'aria-checked', 'false')
      cy.get('[data-cy=type-save]').click()
      cy.get('[data-cy=type-save-bar]').should('not.exist')

      cy.task<{ row: any }>('db:appointmentTypeRow', { id: typeId }).then(({ row }) => {
        expect(row.online_payment_required).to.eq(false)
        expect(row.online_deposit_cents).to.eq(null)
        expect(row.name).to.eq('Primera visita')
      })
      changedColumns(typeId).should('deep.eq', [['online_deposit_cents', 'online_payment_required']])
    })
  })

  it('lowering the price below a hidden deposit clears the deposit, which the deposit check would refuse', () => {
    seedType({ online: true, paymentRequired: false, depositCents: 2000 }).then(({ account, typeId }) => {
      cy.login(account.email, account.password)
      openType(typeId)
      cy.get('[data-cy=type-price]').clear().type('10,00')
      cy.get('[data-cy=type-save]').click()
      cy.get('[data-cy=type-save-bar]').should('not.exist')

      cy.task<{ row: any }>('db:appointmentTypeRow', { id: typeId }).then(({ row }) => {
        expect(row.default_price_cents).to.eq(1000)
        expect(row.online_deposit_cents).to.eq(null)
      })
      changedColumns(typeId).should('deep.eq', [['default_price_cents', 'online_deposit_cents']])
    })
  })
})
