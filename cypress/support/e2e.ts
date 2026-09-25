import './commands'

// Chart.js (used on Dashboard/Reports) triggers a benign, well-known
// "ResizeObserver loop completed with undelivered notifications" error in
// headless Chrome when a chart's container resizes during render. It's not
// an app bug -- swallow only this specific message so smoke tests don't
// fail on it while still failing on any other uncaught error.
Cypress.on('uncaught:exception', (err) => {
  if (/ResizeObserver loop/.test(err.message)) return false
})

// cy.useTouchScreen() emulates through Chrome's DevTools protocol, which a
// new test does not reset -- switch it off so it cannot leak into the next.
afterEach(() => {
  cy.wrap(
    Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setTouchEmulationEnabled',
      params: { enabled: false },
    }).catch(() => null),
    { log: false },
  )
})
