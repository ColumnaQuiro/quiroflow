// Patient segments: saved filters on the patient list, on the Segments tab
// beside "All patients" and "Lists", each with its live count (patient_segments, patients_matching --
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
      cy.get('[data-cy=segment-header]').should('contain', 'VIP sin cita')
      cy.location('search').should('contain', 'segment=')
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.contains('[data-cy=segment-row]', 'VIP sin cita').find('[data-cy=segment-count]').should('have.text', '1')

      // A second one through the bono filter, so two counts are in play.
      // "All patients" from the overview is the open segment again; pressed
      // once more it closes it.
      cy.get('[data-cy=audience-tab-patients]').click()
      cy.get('[data-cy=audience-tab-patients]').click()
      cy.contains('5 patients').should('be.visible')
      cy.get('select[aria-label="Bono"]').select('active')
      cy.get('[data-cy=bono-sessions-max]').type('2')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Diego Casigastado').should('be.visible')
      cy.get('[data-cy=save-segment]').click()
      cy.get('[data-cy=segment-name]').type('Bono casi gastado')
      cy.get('[data-cy=segment-shared]').uncheck()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.contains('[data-cy=segment-row]', 'Bono casi gastado').find('[data-cy=segment-count]').should('have.text', '1')
      cy.contains('[data-cy=segment-row]', 'Bono casi gastado').should('contain', 'Private')

      // The count is live: a second VIP without a booking raises it.
      cy.task('db:createPatient', { ...base, firstName: 'Fani', lastName: 'Tambienvip' }).then((p: any) => {
        cy.task('db:setPatientTags', { patientId: p.id, tags: ['vip'] })
      })

      // Reopen from the Segments tab: its filters come back and its count is
      // current.
      cy.get('[data-cy=audience-tab-patients]').click()
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.contains('[data-cy=segment-row]', 'VIP sin cita').find('[data-cy=segment-count]').should('have.text', '2')
      cy.contains('[data-cy=segment-row]', 'VIP sin cita').find('[data-cy=segment-open]').click()
      cy.contains('2 patients').should('be.visible')
      cy.contains('a', 'Alba Sinfecha').should('be.visible')
      cy.contains('a', 'Fani Tambienvip').should('be.visible')
      cy.contains('a', 'Bruno Concita').should('not.exist')

      // The URL is the list: a reload opens the same patients.
      cy.reload()
      cy.contains('2 patients', { timeout: 15000 }).should('be.visible')
      cy.get('[data-cy=segment-header]').should('contain', 'VIP sin cita')

      // Delete it. The patients stay; the segment goes.
      cy.get('[data-cy=segment-delete]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=segment-header]').should('not.exist')
      cy.location('search').should('not.contain', 'segment=')
      cy.contains('2 patients').should('be.visible')
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.contains('[data-cy=segment-row]', 'VIP sin cita').should('not.exist')
      cy.contains('[data-cy=segment-row]', 'Bono casi gastado').should('exist')
    })
  })

  // Families and consent as segment rules, and the membership an automation
  // reads (patient_segment_members): current the moment the segment is saved,
  // and brought up to date by the fifteen-minute refresh as records change.
  it('keeps a family segment\'s members up to date for the automation engine', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Marta', lastName: 'Madre' }).then((mother) => {
        cy.task('db:setPatientMarketing', { patientId: mother.id, channels: ['email'] })
        cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Hugo', lastName: 'Hijo' }).then((son) => {
          cy.task('db:linkFamily', { accountId: account.accountId, patientId: mother.id, relatedPatientId: son.id, relation: 'child', inverse: 'parent' })
        })
      })
      // A parent who never accepted marketing: in "has a child", out of the segment.
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Pablo', lastName: 'Padre' }).then((father) => {
        cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Irene', lastName: 'Hija' }).then((daughter) => {
          cy.task('db:linkFamily', { accountId: account.accountId, patientId: father.id, relatedPatientId: daughter.id, relation: 'child', inverse: 'parent' })
        })
        cy.wrap(father.id).as('fatherId')
      })
      cy.task('db:createPatient', { ...base, firstName: 'Sola', lastName: 'Sinfamilia' })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('5 patients', { timeout: 15000 }).should('be.visible')

      // New segment from the Segments tab: the list, with the panel open.
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.get('[data-cy=segment-create]').click()
      cy.get('[data-cy=segment-hint]').should('be.visible')
      cy.get('select[aria-label="Family"]').select('child')
      cy.get('select[aria-label="Marketing consent"]').select('email')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Marta Madre').should('be.visible')
      cy.get('[data-cy=save-segment]').click()
      cy.get('[data-cy=segment-name]').type('Padres con publicidad')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=segment-header]').should('contain', 'Padres con publicidad')

      cy.get('[data-cy=audience-tab-patients]').click()
      cy.get('[data-cy=audience-tab-segments]').click()
      cy.contains('[data-cy=segment-row]', 'Padres con publicidad').within(() => {
        cy.get('[data-cy=segment-count]').should('have.text', '1')
        cy.contains('Has a child linked').should('exist')
      })

      cy.task<{ id: string } | null>('db:segmentByName', { accountId: account.accountId, name: 'Padres con publicidad' }).then((segment) => {
        // Saved: its members are there already, without waiting for the cron.
        cy.task('db:audience', { kind: 'segment', id: segment!.id }).should('deep.equal', ['Marta'])

        // The father accepts email: he enters at the next refresh. The cut-off
        // is taken when this step runs, after the segment was saved.
        cy.then(() => new Date().toISOString()).as('beforeHeEnters')
        cy.get<string>('@fatherId').then((fatherId) => cy.task('db:setPatientMarketing', { patientId: fatherId, channels: ['email'] }))
        cy.task('db:refreshSegmentMembers')
        cy.task('db:audience', { kind: 'segment', id: segment!.id }).should('deep.equal', ['Marta', 'Pablo'])
        cy.get<string>('@beforeHeEnters').then((since) => {
          cy.task('db:audience', { kind: 'segment', id: segment!.id, since }).should('deep.equal', ['Pablo'])
        })

        // And leaves when he withdraws it; his stay is still an entry.
        cy.get<string>('@fatherId').then((fatherId) => cy.task('db:setPatientMarketing', { patientId: fatherId, channels: [] }))
        cy.task('db:refreshSegmentMembers')
        cy.task('db:audience', { kind: 'segment', id: segment!.id }).should('deep.equal', ['Marta'])
        cy.get<string>('@beforeHeEnters').then((since) => {
          cy.task('db:audience', { kind: 'segment', id: segment!.id, since }).should('deep.equal', ['Pablo'])
        })
      })

      // The same rules on screen: opening the segment shows the same people.
      cy.contains('[data-cy=segment-row]', 'Padres con publicidad').find('[data-cy=segment-open]').click()
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Marta Madre').should('be.visible')
    })
  })
})
