// Patient segments: saved filters on the patient list, beside "All patients",
// each with its live count (patient_segments, patients_matching --
// 20261022173310_patient_segments.sql).
//
// Save -> reopen -> count -> delete, through the screen, and the URL carrying
// the filters so a segment's link opens the same patients.
describe('Patient segments', () => {
  it('saves a filtered list, reopens it with its count, and deletes it', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      const tomorrow = new Date(Date.now() + 26 * 3600 * 1000).toISOString()

      // VIP without a booking: the one the segment is for.
      cy.task('db:createPatient', { ...base, firstName: 'Alba', lastName: 'Sinfecha' }).then((p: any) => {
        cy.task('db:setPatientTags', { patientId: p.id, tags: ['vip'] })
      })
      // VIP with a booking: excluded by "no future appointment".
      cy.task('db:createPatient', { ...base, firstName: 'Bruno', lastName: 'Concita' }).then((p: any) => {
        cy.task('db:setPatientTags', { patientId: p.id, tags: ['vip'] })
        cy.task('db:createAppointment', { ...base, patientId: p.id, startsAt: tomorrow })
      })
      // Not VIP: excluded by the tag.
      cy.task('db:createPatient', { ...base, firstName: 'Carla', lastName: 'Normal' })
      // One session left on a live bono, and plenty left on another.
      cy.task('db:createPatient', { ...base, firstName: 'Diego', lastName: 'Casigastado' }).then((p: any) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: p.id, sessionsTotal: 10, sessionsUsed: 9 })
      })
      cy.task('db:createPatient', { ...base, firstName: 'Elena', lastName: 'Bonolleno' }).then((p: any) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: p.id, sessionsTotal: 10, sessionsUsed: 2 })
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('5 patients', { timeout: 15000 }).should('be.visible')

      // Filter: tag vip, no future appointment.
      cy.get('[data-cy=more-filters-toggle]').click()
      cy.contains('[data-cy=tag-option]', 'vip').click()
      cy.get('select[aria-label="Next appointment"]').select('no')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Alba Sinfecha').should('be.visible')
      cy.location('search').should('contain', 'tags=vip').and('contain', 'futureAppointment=no')

      // Save it as a segment.
      cy.get('[data-cy=save-segment]').click()
      cy.get('[data-cy=segment-name]').type('VIP sin cita')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').should('have.attr', 'aria-current', 'true')
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').find('[data-cy=segment-count]').should('have.text', '1')
      cy.location('search').should('contain', 'segment=')

      // A second one through the bono filter, so two counts are in play.
      cy.contains('button', 'All patients').click()
      cy.contains('5 patients').should('be.visible')
      cy.get('select[aria-label="Bono"]').select('active')
      cy.get('[data-cy=bono-sessions-max]').type('2')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Diego Casigastado').should('be.visible')
      cy.get('[data-cy=save-segment]').click()
      cy.get('[data-cy=segment-name]').type('Bono casi gastado')
      cy.get('[data-cy=segment-shared]').uncheck()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=segment-item]', 'Bono casi gastado').find('[data-cy=segment-count]').should('have.text', '1')

      // The count is live: a second VIP without a booking raises it.
      cy.task('db:createPatient', { ...base, firstName: 'Fani', lastName: 'Tambienvip' }).then((p: any) => {
        cy.task('db:setPatientTags', { patientId: p.id, tags: ['vip'] })
      })

      // Reopen from the list: its filters come back and its count is current.
      cy.contains('button', 'All patients').click()
      cy.contains('6 patients').should('be.visible')
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').click()
      cy.contains('2 patients').should('be.visible')
      cy.contains('a', 'Alba Sinfecha').should('be.visible')
      cy.contains('a', 'Fani Tambienvip').should('be.visible')
      cy.contains('a', 'Bruno Concita').should('not.exist')
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').find('[data-cy=segment-count]').should('have.text', '2')

      // The URL is the list: a reload opens the same patients.
      cy.reload()
      cy.contains('2 patients', { timeout: 15000 }).should('be.visible')
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').should('have.attr', 'aria-current', 'true')

      // Delete it. The patients stay; the segment goes.
      cy.get('[data-cy=segment-delete]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=segment-item]', 'VIP sin cita').should('not.exist')
      cy.contains('[data-cy=segment-item]', 'Bono casi gastado').should('exist')
      cy.location('search').should('not.contain', 'segment=')
      cy.contains('2 patients').should('be.visible')
    })
  })
})
