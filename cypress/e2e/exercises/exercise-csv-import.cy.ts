// Importing exercises into the library from a CSV (Library › Import CSV,
// components/exercises/ImportDialog.vue). The fixture is what a Spanish Excel
// saves: `;`, a BOM, a quoted cell with a `;` and a line break in it, and
// YouTube links written three different ways. Four of its seven rows cannot be
// created -- no name, a link that is not a video, a name the library already
// has, a name repeated in the file -- and the preview says so before anything
// is written.

describe('Exercise library CSV import', () => {
  it('previews a file, flags the rows it cannot create, and creates the rest with their videos', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Sentarse y levantarse' }] })

      cy.login(account.email, account.password)
      cy.visit('/exercises?section=library')
      cy.get('[data-cy="settings-list"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="library-row"]').should('have.length', 1)

      cy.get('[data-cy="library-import"]').click()
      cy.get('[data-cy="exercise-import-file"]').selectFile('cypress/fixtures/exercises-import.csv', { force: true })

      cy.get('[data-cy="exercise-import-row"]').should('have.length', 7)
      cy.get('[data-cy="exercise-import-valid"]').should('contain', '3 ready to import')
      cy.get('[data-cy="exercise-import-flagged"]').should('contain', '4 will be skipped')
      cy.get('[data-cy="exercise-import-row"][data-problem="missing_name"]').should('have.length', 1)
      cy.get('[data-cy="exercise-import-row"][data-problem="bad_video"]').should('contain', 'Plancha')
      cy.get('[data-cy="exercise-import-row"][data-problem="exists"]').should('contain', 'sentarse y levantarse')
      cy.get('[data-cy="exercise-import-row"][data-problem="repeated"]').should('contain', 'rotacion toracica')
      // Every way of writing the link becomes the same watch address.
      cy.contains('[data-cy="exercise-import-row"]', 'Gato-camello').find('[data-cy="exercise-import-row-video"]').should('have.attr', 'href', 'https://www.youtube.com/watch?v=ccccccccccc')

      cy.get('[data-cy="exercise-import-confirm"]').should('contain', 'Import 3 exercises').click()
      cy.get('[data-cy="exercise-import-created"]').should('contain', '3 exercises created')
      cy.get('[data-cy="exercise-import-skipped"]').should('contain', '4 rows skipped')
      cy.get('[data-cy="exercise-import-done"]').click()
      cy.get('[data-cy="exercise-import"]').should('not.exist')

      cy.get('[data-cy="library-row"]').should('have.length', 4)
      cy.contains('[data-cy="library-row"]', 'Puente de glúteo').find('[data-cy="library-row-link"]').should('have.attr', 'href', 'https://www.youtube.com/watch?v=bbbbbbbbbbb')

      cy.task<{ name: string; instructions: string | null; media_url: string | null; created_by: string | null }[]>('db:selectRows', {
        table: 'exercises',
        columns: 'name, instructions, media_url, created_by',
        match: { account_id: account.accountId },
      }).then((rows) => {
        const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
        expect(Object.keys(byName).sort()).to.deep.equal(['Gato-camello', 'Puente de glúteo', 'Rotación torácica', 'Sentarse y levantarse'])
        expect(byName['Rotación torácica'].media_url).to.equal('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        expect(byName['Rotación torácica'].instructions).to.equal('A cuatro patas; gira el tronco.\n10 por lado.')
        expect(byName['Gato-camello'].instructions).to.equal(null)
        expect(byName['Puente de glúteo'].created_by).to.be.a('string')
      })
    })
  })

  it('refuses a file with no name column and offers the template', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/exercises?section=library')
      cy.get('[data-cy="settings-list"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="library-import"]').click()
      cy.get('[data-cy="exercise-import-template"]').should('be.visible')
      cy.get('[data-cy="exercise-import-file"]').selectFile({ contents: Cypress.Buffer.from('video,notas\nhttps://youtu.be/aaaaaaaaaaa,x\n'), fileName: 'sin-nombre.csv', mimeType: 'text/csv' }, { force: true })
      cy.get('[data-cy="exercise-import-file-error"]').should('contain', 'nombre')
      cy.get('[data-cy="exercise-import-row"]').should('not.exist')
    })
  })
})
