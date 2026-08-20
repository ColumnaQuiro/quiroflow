import './commands'

// Chart.js (used on Dashboard/Reports) triggers a benign, well-known
// "ResizeObserver loop completed with undelivered notifications" error in
// headless Chrome when a chart's container resizes during render. It's not
// an app bug -- swallow only this specific message so smoke tests don't
// fail on it while still failing on any other uncaught error.
Cypress.on('uncaught:exception', (err) => {
  if (/ResizeObserver loop/.test(err.message)) return false
})
