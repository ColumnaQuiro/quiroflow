// Guards against server-rendered markup disagreeing with what the client
// renders on hydration. Vue only reports these in a dev build, which is
// exactly what the e2e suite runs against, so this is the one place in CI
// that can see them at all.
//
// Both mismatches this was written for came from state that exists only in
// the browser being read during SSR: the theme toggle picked its icon from a
// preference held in localStorage, and the dashboard's date and greeting came
// from the viewer's own clock. Neither is knowable on the server, and the
// second was a correctness bug as well -- a clinic in a distant timezone was
// shown the wrong day, not merely a differently formatted one.

/** Loads `path` and returns every console.error Vue logged while hydrating. */
function visitAndCollectErrors(path: string, theme: 'light' | 'dark') {
  const errors: string[] = []
  cy.visit(path, {
    onBeforeLoad(win) {
      // Set before any app code runs, so the theme plugin reads it on boot
      // and the very first client render is the themed one -- which is the
      // case that used to mismatch.
      win.localStorage.setItem('quiroflow-theme', theme)
      cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
        errors.push(args.map(String).join(' '))
      })
    },
  })
  return cy.wrap(errors, { log: false })
}

describe('Server-rendered pages hydrate without mismatches', () => {
  // Seeded once, not per test: nothing here writes anything, and three
  // separate account creations against local Supabase is enough auth traffic
  // to time the suite out on a busy machine.
  let account: { email: string; password: string }

  before(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded
    })
  })

  beforeEach(() => {
    cy.login(account.email, account.password)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`renders the dashboard consistently on server and client (${theme} theme)`, () => {
      visitAndCollectErrors('/dashboard', theme).then((errors) => {
        // Wait for the page itself, so hydration has actually happened by the
        // time the assertion runs rather than passing on an empty document.
        cy.contains('Dashboard').should('be.visible')
        cy.then(() => {
          const hydration = (errors as string[]).filter((e) => e.includes('Hydration'))
          expect(hydration, `hydration mismatches on /dashboard (${theme})`).to.deep.eq([])
        })
      })
    })
  }

  it('renders the Growth dashboard consistently on server and client', () => {
    visitAndCollectErrors('/growth?growth=1', 'dark').then((errors) => {
      cy.contains('Acquisition funnel').should('be.visible')
      cy.then(() => {
        const hydration = (errors as string[]).filter((e) => e.includes('Hydration'))
        expect(hydration, 'hydration mismatches on /growth').to.deep.eq([])
      })
    })
  })
})
