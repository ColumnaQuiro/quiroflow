// Payment reminders: the invoice.overdue automation trigger, checked by the
// daily automations cron (birthday-cron). An invoice that has just reached N
// days unpaid gets one reminder per automation, with a stable link to pay by
// card; paid ones, old debts and patients whose reminders are paused do not.

interface SeededAccount { email: string; password: string; accountId: string; clinicId: string }

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('Payment reminders', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const cron = () => cy.request({ method: 'POST', url: '/api/automations/birthday-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
  const patient = (firstName: string, extra: Record<string, unknown> = {}) =>
    cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Factura', phone: randomPhone(), ...extra })
  const invoice = (patientId: string, ageDays: number, status = 'unpaid') =>
    cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId, totalCents: 4500, status }).then((inv) => {
      cy.task('db:updateRows', { table: 'invoices', values: { created_at: daysAgo(ageDays) }, match: { id: inv.id } })
      return cy.wrap(inv)
    })

  it('reminds once about an invoice that has just reached N days, with a link to pay', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Recordatorio de pago',
      dryRun: true,
      triggerEvent: 'invoice.overdue',
      filters: { days_overdue: 7 },
      actions: [{ type: 'whatsapp_template', config: { template_name: 'recordatorio_pago', template_language: 'es' } }],
    })
    patient('Debe').then((debe) => {
      patient('Pagada').then((pagada) => {
        patient('Antigua').then((antigua) => {
          patient('Pausada').then((pausada) => {
            cy.task('db:updateRows', { table: 'patients', values: { invoice_reminders_paused: true }, match: { id: pausada.id } })
            invoice(debe.id, 8).then((inv) => {
              invoice(pagada.id, 8, 'paid')
              // Owed since long before the reminder existed: never messaged.
              invoice(antigua.id, 60)
              invoice(pausada.id, 8)

              cron().its('body.invoiceReminders').should('eq', 1)
              cy.task('auto:whatsappFor', { patientId: debe.id }).should('have.length', 1)
              cy.task('auto:whatsappFor', { patientId: pagada.id }).should('have.length', 0)
              cy.task('auto:whatsappFor', { patientId: antigua.id }).should('have.length', 0)
              cy.task('auto:whatsappFor', { patientId: pausada.id }).should('have.length', 0)

              // Once per automation and invoice, however often the cron runs.
              cron().its('body.invoiceReminders').should('eq', 0)
              cy.task('auto:whatsappFor', { patientId: debe.id }).should('have.length', 1)

              // The link it carries: a fresh card payment each time it is
              // opened -- here, a clinic with no card payments says so.
              cy.task<{ pay_token: string | null }[]>('db:selectRows', { table: 'invoices', columns: 'pay_token', match: { id: inv.id } }).then(([row]) => {
                expect(row!.pay_token).to.match(/^[0-9a-f-]{36}$/)
                cy.request({ url: `/api/pay/${row!.pay_token}`, followRedirect: false }).then((res) => {
                  expect(res.status).to.eq(302)
                  expect(res.redirectedToUrl).to.contain('/payment-done?status=unavailable')
                })
              })
              // Paid since: the link says so instead of charging again.
              cy.task('db:updateRows', { table: 'invoices', values: { status: 'paid' }, match: { id: inv.id } })
              cy.task<{ pay_token: string }[]>('db:selectRows', { table: 'invoices', columns: 'pay_token', match: { id: inv.id } }).then(([row]) => {
                cy.request({ url: `/api/pay/${row!.pay_token}`, followRedirect: false }).its('redirectedToUrl').should('contain', 'status=already_paid')
              })
              cy.request({ url: '/api/pay/00000000-0000-0000-0000-000000000000', followRedirect: false }).its('redirectedToUrl').should('contain', 'status=invalid')
            })
          })
        })
      })
    })
  })

  it("is paused per patient from their Billing tab, which says when they were last reminded", () => {
    cy.task('db:createAutomationRule', { accountId: account.accountId, name: 'Recordatorio de pago', dryRun: true, triggerEvent: 'invoice.overdue', filters: { days_overdue: 7 }, actions: [{ type: 'whatsapp_template', config: { template_name: 'recordatorio_pago', template_language: 'es' } }] })
    patient('Ficha').then((p) => {
      invoice(p.id, 8)
      cron().its('body.invoiceReminders').should('eq', 1)
      cy.login(account.email, account.password)
      cy.visit(`/patients/${p.id}?tab=billing`)
      cy.get('[data-cy=invoice-reminders]').should('be.visible')
      cy.get('[data-cy=invoice-reminders-last]').should('contain.text', 'Last sent')
      cy.get('[data-cy=invoice-reminders-switch]').should('have.attr', 'aria-checked', 'true').click()
      cy.get('[data-cy=invoice-reminders-state]').should('contain.text', 'Paused')
      cy.task<{ invoice_reminders_paused: boolean }[]>('db:selectRows', { table: 'patients', columns: 'invoice_reminders_paused', match: { id: p.id } }).its('0.invoice_reminders_paused').should('eq', true)
    })
  })
})
