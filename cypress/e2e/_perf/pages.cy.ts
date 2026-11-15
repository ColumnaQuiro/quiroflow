// Temporary measurement, not a test: for each main page, how many Supabase
// round trips a full load makes, how many "waves" (requests that could only
// start after an earlier one answered), and how long until the last one
// answered. Written to cypress/_perf.json. Not committed.
type Hit = { path: string; start: number; end: number }

const ROUTES = ['/dashboard', '/calendar', '/patients', '/inbox', '/practitioner', '/billing', '/reports', '/recalls', '/settings']

describe('page load round trips', () => {
  it('measures', () => {
    const results: Record<string, unknown>[] = []
    cy.seedStaffAccount().then((account) => {
      const today = new Date()
      const patientIds: string[] = []
      for (let i = 0; i < 12; i++) {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Perf', lastName: String(i).padStart(2, '0'), email: `perf${i}@example.test` }).then((p) => {
          patientIds.push(p.id)
          const at = new Date(today); at.setHours(9 + (i % 8), 0, 0, 0); at.setDate(at.getDate() + (i % 3) - 1)
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: at.toISOString() })
          if (i % 2 === 0) cy.task('db:createInvoice', { accountId: account.accountId, patientId: p.id, totalCents: 5000 })
          if (i % 3 === 0) cy.task('db:createPayment', { accountId: account.accountId, patientId: p.id, amountCents: 5000, method: 'cash' })
        })
      }
      cy.then(() => cy.login(account.email, account.password))
      cy.then(() => {
        const routes = [...ROUTES, `/patients/${patientIds[0]}`]
        for (const route of routes) {
          const hits: Hit[] = []
          let t0 = 0
          cy.intercept({ url: /\/rest\/v1\/|\/api\//, middleware: true }, (req) => {
            const start = Date.now()
            req.on('response', () => { const u = new URL(req.url); hits.push({ path: u.pathname.replace(/^\/rest\/v1\//, '') + decodeURIComponent(u.search).slice(0, 90), start, end: Date.now() }) })
          }).as('rest')
          cy.then(() => { t0 = Date.now() })
          cy.visit(route)
          // settled: no new request started for 2.5 s
          cy.wrap(null).then({ timeout: 40000 }, () => new Promise<void>((resolve) => {
            const tick = () => {
              const last = hits.reduce((m, h) => Math.max(m, h.end), 0)
              if (hits.length > 0 && Date.now() - last > 2500) resolve()
              else setTimeout(tick, 250)
            }
            setTimeout(tick, 1500)
          }))
          cy.then(() => {
            const sorted = [...hits].sort((a, b) => a.start - b.start)
            // a wave starts when a request begins after every earlier request has ended
            let waves = 0; let frontier = 0
            for (const h of sorted) { if (h.start >= frontier - 5) waves++; frontier = Math.max(frontier, h.end) }
            const byPath: Record<string, number> = {}
            for (const h of hits) byPath[h.path] = (byPath[h.path] ?? 0) + 1
            results.push({ route, requests: hits.length, waves, settledMs: Math.max(...hits.map((h) => h.end)) - t0, firstMs: Math.min(...hits.map((h) => h.start)) - t0, byPath })
          })
        }
      })
      cy.then(() => cy.writeFile('cypress/_perf.json', results))
    })
  })
})
