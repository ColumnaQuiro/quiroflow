// QuiroHiro's "Import everything" runs on the server as an import job
// (server/utils/quirohiroImportJob.ts); the page only watches import_jobs.
// So the spec writes the job's rows itself -- running, then finished -- and
// checks the screen follows them, without a real QuiroHiro behind it.
describe('QuiroHiro import running on the server', () => {
  it('shows the saved connection, the patients-or-everyone choice, and a job until it ends', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', {
        table: 'account_secrets',
        rows: [
          { account_id: account.accountId, name: 'quirohiro_token', value: 'pit-00000000-0000-0000-0000-000000000000' },
          { account_id: account.accountId, name: 'quirohiro_location_id', value: 'LocationTest1234' },
          { account_id: account.accountId, name: 'quirohiro_location_name', value: 'Clínica de Prueba' },
        ],
      })
      cy.login(account.email, account.password)

      // The connection is saved, and the token never comes back to the page.
      cy.visit('/settings/import?source=quirohiro&type=general')
      cy.get('[data-cy="qh-connected"]', { timeout: 15000 }).should('contain', 'Clínica de Prueba')
      cy.get('[data-cy="qh-token"]').should('have.value', '')
      cy.get('[data-cy="import-source-quirohiro"]').should('contain', 'Connected')

      // Nothing has run: the clinic chooses who comes in, patients by default.
      cy.visit('/settings/import?source=quirohiro&type=full')
      cy.get('[data-cy="qh-who-patients"]', { timeout: 15000 }).should('be.checked')
      cy.get('[data-cy="qh-who-everyone"]').should('not.be.checked')
      cy.get('[data-cy="qh-full-preview"]').should('be.visible')
      cy.get('[data-cy="qh-full-start"]').should('contain', 'Import everything')

      // Held by a slice for the next hour, so nothing on the server picks it
      // up while the spec runs.
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'import_jobs',
        rows: [{
          account_id: account.accountId,
          clinic_id: account.clinicId,
          source: 'quirohiro',
          steps: ['read', 'patients', 'appointments', 'clinical'],
          status: 'running',
          options: { who: 'patients', quietUpcoming: true },
          progress: { phase: 'read', listIndex: 4, listCount: 7, page: 8, pageCount: 36 },
          locked_until: new Date(Date.now() + 3_600_000).toISOString(),
          started_by: account.teamMemberId,
        }],
      }).then(([job]) => {
        cy.reload()
        cy.get('[data-cy="qc-job"]', { timeout: 15000 }).should('have.attr', 'data-status', 'running')
        cy.get('[data-cy="qc-job-now"]').should('contain', 'Reading QuiroHiro: contacts, 8 of 36')
        cy.get('[data-cy="qc-job"]').should('contain', 'Step 1 of 4').and('contain', 'Read QuiroHiro')
        // A second import cannot be started beside it.
        cy.get('[data-cy="qh-full-start"]').should('not.exist')

        cy.task('db:updateRows', {
          table: 'import_jobs',
          match: { id: job!.id },
          values: {
            status: 'done',
            step_index: 4,
            progress: {},
            locked_until: null,
            finished_at: new Date().toISOString(),
            results: [
              { step: 'read', written: 9000, errors: [], warnings: [] },
              { step: 'patients', written: 1500, errors: [], warnings: ['2071 contacts are leads QuiroHiro holds no appointment or clinical record for, and are left out.'] },
              { step: 'appointments', written: 4600, errors: [], warnings: [] },
              { step: 'clinical', written: 4750, errors: [], warnings: [] },
            ],
          },
        })
        // Polled every few seconds: it ends without a reload.
        cy.get('[data-cy="qc-job"]', { timeout: 15000 }).should('have.attr', 'data-status', 'done')
        cy.get('[data-cy="qc-job"]').should('contain', '9000 records').and('contain', '1500 saved').and('contain', 'Clinical records and notes')
        cy.get('[data-cy="qh-full-start"]').should('contain', 'Import everything again')
      })
    })
  })
})
