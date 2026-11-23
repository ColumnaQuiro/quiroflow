// "Import everything" runs on the server as an import job
// (server/utils/importJobs.ts); the page only watches import_jobs. So the
// spec writes the job's rows itself -- running, then finished -- and checks
// the screen follows them, without a real Quirocitas behind it.
describe('Quirocitas import running on the server', () => {
  it('shows a running job and keeps up with it until it ends, with what each step did', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', {
        table: 'account_secrets',
        rows: [
          { account_id: account.accountId, name: 'quirocitas_base_url', value: 'https://quirocitas.example/chiro' },
          { account_id: account.accountId, name: 'quirocitas_username', value: 'demo' },
          { account_id: account.accountId, name: 'quirocitas_password', value: 'demo' },
        ],
      })
      // Held by a slice for the next hour, so nothing on the server picks it
      // up while the spec runs.
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'import_jobs',
        rows: [{
          account_id: account.accountId,
          clinic_id: account.clinicId,
          source: 'quirocitas',
          steps: ['read', 'patients', 'appointments', 'clinical', 'bonos', 'ledger', 'files'],
          status: 'running',
          progress: { phase: 'patients', done: 40, total: 120, failed: 0 },
          locked_until: new Date(Date.now() + 3_600_000).toISOString(),
          started_by: account.teamMemberId,
        }],
      }).then(([job]) => {
        cy.login(account.email, account.password)
        cy.visit('/settings/import?source=quirocitas&type=full')

        cy.get('[data-cy="qc-job"]', { timeout: 15000 }).should('have.attr', 'data-status', 'running')
        cy.get('[data-cy="qc-job-now"]').should('contain', 'Reading patients: 40 of 120')
        cy.get('[data-cy="qc-job"]').should('contain', 'Step 1 of 7').and('contain', 'you can close this page')
        // A second import cannot be started beside it.
        cy.get('[data-cy="qc-full-start"]').should('not.exist')

        cy.task('db:updateRows', {
          table: 'import_jobs',
          match: { id: job!.id },
          values: {
            status: 'done',
            step_index: 7,
            progress: {},
            locked_until: null,
            finished_at: new Date().toISOString(),
            results: [
              { step: 'read', written: 120, errors: [], warnings: [] },
              { step: 'patients', written: 120, errors: [], warnings: [] },
              { step: 'appointments', written: 480, errors: [], warnings: [] },
              { step: 'clinical', written: 360, errors: [], warnings: [] },
              { step: 'bonos', written: 120, errors: [], warnings: [] },
              { step: 'ledger', written: 300, errors: ['One payment could not be saved.'], warnings: [] },
              { step: 'files', written: 120, errors: [], warnings: [] },
            ],
          },
        })

        // Polled every few seconds: it ends without a reload.
        cy.get('[data-cy="qc-job"]', { timeout: 15000 }).should('have.attr', 'data-status', 'done')
        cy.get('[data-cy="qc-job-ended"]').should('contain', 'Finished')
        cy.get('[data-cy="qc-job"]').should('contain', '480 saved').and('contain', '1 problem')
        cy.get('[data-cy="qc-full-start"]').should('be.visible').and('contain', 'Import everything')
      })
    })
  })

  // A slice cut off by the platform (out of time or memory) never reaches its
  // save and throws nothing, so it used to be retried every two minutes for
  // ever, the job "running" and every new import refused beside it. Each
  // slice now marks the job before it works; one that finds the last four
  // marks never cleared ends the job instead of trying a fifth time.
  it('ends a job whose slices keep getting cut off, instead of retrying it for ever', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'import_jobs',
        rows: [{
          account_id: account.accountId,
          clinic_id: account.clinicId,
          source: 'quirocitas',
          steps: ['read', 'patients', 'appointments'],
          step_index: 2,
          status: 'running',
          // Four slices claimed it and none of them saved.
          progress: { unfinished: 4 },
          locked_until: null,
          started_by: account.teamMemberId,
        }],
      }).then(([job]) => {
        cy.request({ method: 'POST', url: `/api/import/jobs/${job!.id}/slice`, headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
          .its('body').should('deep.include', { claimed: true, more: false })
        cy.task<any[]>('db:selectRows', { table: 'import_jobs', columns: 'status, error, progress, locked_until, finished_at', match: { id: job!.id } }).then(([row]) => {
          expect(row.status).to.eq('failed')
          expect(row.error).to.contain('se cortaron antes de terminar')
          expect(row.progress).not.to.have.property('unfinished')
          expect(row.locked_until).to.eq(null)
          expect(row.finished_at).to.be.a('string')
        })
      })
    })
  })
})
