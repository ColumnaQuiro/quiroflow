// A video uploaded for a library exercise (bucket exercise-media, private):
// staff attach it in Settings > Exercise Library, the patient it was given
// to plays it inside the portal / app, and nobody else can sign it -- not
// another patient of the same clinic, not another clinic's staff. Replacing
// it removes the old file.

const fakeVideo = (name: string) => ({ contents: Cypress.Buffer.from('not really a video, but a video by type'), fileName: name, mimeType: 'video/mp4' })

describe('Exercise video upload', () => {
  it("is played by the patient it was given to, and signed for nobody else's", () => {
    const stamp = Date.now()
    const mine = { email: `ex-media-${stamp}@example.test`, password: 'valencia2026' }
    const notMine = { email: `ex-media-other-${stamp}@example.test`, password: 'valencia2026' }
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Sentadilla' }] }).then(([exercise]) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Ibáñez' }).then((patient) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, ...mine })
          cy.task('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: account.accountId, patient_id: patient.id, exercise_id: exercise.id, sets: 3, reps: '10' }] })
        })
        // Same clinic, has the app, was NOT given it.
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Ortiz' }).then((other) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: other.id, ...notMine })
        })

        // Staff attach the video.
        cy.login(account.email, account.password)
        cy.visit('/settings/exercises')
        cy.get('[data-cy="settings-list"][data-ready="true"]')
        cy.contains('[data-cy="library-row"]', 'Sentadilla').find('[data-cy="library-edit"]').click()
        cy.get('[data-cy="exercise-media-input"]').selectFile(fakeVideo('sentadilla.mp4'), { force: true })
        cy.get('[data-cy="exercise-media-attached"]').should('contain', 'Video attached')
        cy.get('[data-cy="library-save"]').click()
        cy.contains('[data-cy="library-row"]', 'Sentadilla').find('[data-cy="library-row-media"]').should('contain', 'Video')

        cy.task<{ media_path: string }[]>('db:selectRows', { table: 'exercises', columns: 'media_path', match: { id: exercise.id } }).then(([row]) => {
          const path = row.media_path
          expect(path).to.match(new RegExp(`^${account.accountId}/[0-9a-f-]+\\.mp4$`))
          cy.task('db:storageObjectExists', { bucket: 'exercise-media', path }).should('eq', true)

          // Nobody else can sign it.
          cy.task<{ url: string | null }>('db:storageSignAsUser', { ...notMine, bucket: 'exercise-media', path }).its('url').should('eq', null)
          cy.seedStaffAccount().then((stranger) => {
            cy.task<{ url: string | null }>('db:storageSignAsUser', { email: stranger.email, password: stranger.password, bucket: 'exercise-media', path }).its('url').should('eq', null)
          })
          cy.task<{ url: string | null }>('db:storageSignAsUser', { ...mine, bucket: 'exercise-media', path }).its('url').should('match', /exercise-media/)

          // The patient plays it in place.
          cy.clearAllCookies()
          cy.clearAllLocalStorage()
          cy.login(mine.email, mine.password)
          cy.visit('/portal/exercises')
          cy.get('[data-cy="exercise-upload-toggle"]').should('contain', 'Watch the video').click()
          cy.get('[data-cy="exercise-upload-player"] video').should('have.attr', 'src').and('match', /\/object\/sign\/exercise-media\//)
          cy.clearAllCookies()
          cy.clearAllLocalStorage()

          // Replacing it removes the old file.
          cy.login(account.email, account.password)
          cy.visit('/settings/exercises')
          cy.get('[data-cy="settings-list"][data-ready="true"]')
          cy.contains('[data-cy="library-row"]', 'Sentadilla').find('[data-cy="library-edit"]').click()
          cy.get('[data-cy="exercise-media-remove"]').click()
          cy.get('[data-cy="exercise-media-input"]').selectFile(fakeVideo('otra.mp4'), { force: true })
          cy.get('[data-cy="exercise-media-attached"]').should('exist')
          cy.get('[data-cy="library-save"]').click()
          cy.get('[data-cy="library-form"]').should('not.exist')
          cy.task('db:storageObjectExists', { bucket: 'exercise-media', path }).should('eq', false)
        })
      })
    })
  })

  it('refuses a file that is not a video or a photo', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/exercises')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.get('[data-cy="library-new"]').click()
      cy.get('[data-cy="exercise-media-input"]').selectFile({ contents: Cypress.Buffer.from('%PDF-1.4'), fileName: 'pauta.pdf', mimeType: 'application/pdf' }, { force: true })
      cy.get('[data-cy="exercise-media-field"]').should('contain', 'Choose a video (MP4, MOV) or a photo.')
      cy.get('[data-cy="exercise-media-attached"]').should('not.exist')
    })
  })
})
