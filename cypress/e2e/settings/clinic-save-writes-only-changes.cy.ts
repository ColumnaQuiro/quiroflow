// Settings > Clinics > one clinic: Save writes the columns that were edited
// and nothing else.
//
// It used to send the whole form. The form had normalised what it loaded --
// opening hours given every day and their ranges sorted, an empty legal name
// or NIF turned into null on the way back -- so changing the phone number also
// rewrote the hours and the fiscal fields, and the activity log recorded all of
// them as that person's edit.
describe('Settings > Clinics > clinic: Save writes only what changed', () => {
  // Stored the way an import or an older version of the page left them: days
  // missing, ranges out of order, and empty strings rather than null.
  const UNNORMALISED_HOURS = { mon: [['16:00', '20:00'], ['09:00', '14:00']], wed: [['10:00', '13:00']] }

  function openClinic(clinicId: string) {
    cy.visit(`/settings/clinics/${clinicId}`)
    cy.get('[data-cy=clinic-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
  }

  // The columns each staff edit of the clinic changed, oldest first. Only
  // staff edits: the seeding writes as the server.
  function changedColumns(clinicId: string, check: (columns: string[][]) => void) {
    cy.task<any[]>('db:auditLogFor', { entityId: clinicId }).then((rows) => {
      check(rows.filter((r) => r.entity_type === 'clinic' && r.action === 'updated' && r.actor === 'staff').map((r) => Object.keys(r.changes ?? {})))
    })
  }

  it('changing the phone number changes the phone number and nothing else', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', {
        clinicId: account.clinicId,
        phone: '600111222',
        address: '',
        email: '',
        legalName: '',
        taxId: '',
        footerText: '',
        businessHours: UNNORMALISED_HOURS,
      })
      cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).then((before) => {
        expect(before.legal_name).to.eq('')
        expect(before.business_hours).to.deep.eq(UNNORMALISED_HOURS)

        cy.login(account.email, account.password)
        openClinic(account.clinicId)
        cy.get('[data-cy=clinic-save-bar]').should('not.exist')
        cy.get('[data-cy=clinic-phone]').clear().type('600333444')
        cy.get('[data-cy=clinic-save]').click()
        cy.get('[data-cy=clinic-save-bar]').should('not.exist')

        cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).then((after) => {
          expect(after.phone).to.eq('600333444')
          expect(after.legal_name).to.eq('')
          expect(after.tax_id).to.eq('')
          expect(after.business_hours).to.deep.eq(UNNORMALISED_HOURS)
          expect({ ...after, phone: before.phone }).to.deep.eq(before)
        })
        changedColumns(account.clinicId, (columns) => expect(columns).to.deep.eq([['phone']]))
      })
    })
  })

  it('a clinic with no hours keeps them as stored, and editing the hours still writes a full week', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', { clinicId: account.clinicId, businessHours: {} })
      cy.login(account.email, account.password)
      openClinic(account.clinicId)
      cy.get('[data-cy=hours-not-set]').should('exist')
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')

      cy.get('[data-cy=clinic-name]').clear().type('Clínica Demo Norte')
      cy.get('[data-cy=clinic-save]').click()
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')
      cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).then((c) => {
        expect(c.name).to.eq('Clínica Demo Norte')
        expect(c.business_hours).to.deep.eq({})
      })

      // Opening a day and closing it again is no change at all.
      cy.get('[data-cy=hours-day][data-day="tue"]').find('[data-cy=hours-day-toggle]').click()
      cy.get('[data-cy=clinic-save-bar]').should('be.visible')
      cy.get('[data-cy=hours-day][data-day="tue"]').find('[data-cy=hours-day-toggle]').click()
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')

      // A real hours change is written whole, every day present.
      cy.get('[data-cy=hours-day][data-day="tue"]').find('[data-cy=hours-day-toggle]').click()
      cy.get('[data-cy=hours-day][data-day="tue"]').find('[data-cy=hours-range]').first().find('input[type=time]').eq(0).clear().type('09:00')
      cy.get('[data-cy=hours-day][data-day="tue"]').find('[data-cy=hours-range]').first().find('input[type=time]').eq(1).clear().type('14:00')
      cy.get('[data-cy=clinic-save]').click()
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')
      cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).then((c) => {
        expect(c.business_hours).to.deep.eq({ mon: [], tue: [['09:00', '14:00']], wed: [], thu: [], fri: [], sat: [], sun: [] })
      })
      changedColumns(account.clinicId, (columns) => expect(columns).to.deep.eq([['name'], ['business_hours']]))
    })
  })
})
