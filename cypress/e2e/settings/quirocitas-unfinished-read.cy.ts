// A Quirocitas read that stopped part way (a reload, a closed tab) left a copy
// of only some of the clinic's patients, and every import step imported from
// it without a word: the patients never read, and all their visits, were
// missing from the calendar afterwards. An unfinished copy now stops each step
// until the read is finished, unless importing only what was read is chosen.
//
// The copy lives on the server now (import_snapshots, one row per patient
// record plus a 'meta' row), so the spec writes one there rather than reading
// a real Quirocitas.
function putCopy(accountId: string, copy: typeof unfinished) {
  const { patients, ...meta } = copy
  return cy.task('db:insertRows', {
    table: 'import_snapshots',
    rows: [
      { account_id: accountId, source: 'quirocitas', key: 'meta', data: meta },
      ...Object.entries(patients).map(([id, record]) => ({ account_id: accountId, source: 'quirocitas', key: `patient:${id}`, data: record })),
    ],
  })
}

const unfinished = {
  baseUrl: 'https://quirocitas.example',
  readAt: '2026-11-16T10:00:00.000Z',
  bonoTypes: [],
  // One record fetched in this pass, of the three the list named.
  patients: {
    101: {
      list: { id: '101', name: 'Laura Demo Prueba', tel: '' },
      ficha: { appointments: [], bonos: [], visits: [] },
      history: { visits: [], tests: [], segments: [] },
      invoices: [],
      techniques: {},
      readAt: '2026-11-16T10:01:00.000Z',
    },
  },
  failed: {},
  ledger: [],
  ledgerMonths: [],
  passStartedAt: '2026-11-16T10:00:00.000Z',
  listTotal: 3,
}

describe('Quirocitas import from an unfinished read', () => {
  it('stops each step until the read is finished, unless importing only what was read', () => {
    cy.seedStaffAccount().then((account) => {
      putCopy(account.accountId, unfinished)
      cy.login(account.email, account.password)

      cy.visit('/settings/import?source=quirocitas&type=appointments')
      cy.get('[data-cy="qc-step-appointments"]').should('exist')
      cy.get('[data-cy="qc-read-unfinished"]', { timeout: 15000 })
        .should('be.visible')
        .and('contain', '1 of 3 patients read')
      cy.get('[data-cy="qc-prepare"]').should('not.exist')

      cy.get('[data-cy="qc-import-partial"]').click()
      cy.get('[data-cy="qc-read-unfinished"]').should('not.exist')
      cy.get('[data-cy="qc-prepare"]').should('be.visible')

      // The Read screen says so too, with the count.
      cy.visit('/settings/import?source=quirocitas&type=read')
      cy.get('[data-cy="qc-read-unfinished-summary"]', { timeout: 15000 })
        .should('be.visible')
        .and('contain', '1 of 3 patients')
    })
  })
})
