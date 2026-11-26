// "Reservas online con QuiroFlow" under an embedded booking box.
//
// The widget is a cross-site iframe, and a link inside it is the framed
// page's, so no clinic site embedding it ever linked to QuiroFlow. public/
// embed.js now puts one branded line on the clinic's own page, when the widget
// says so -- which it does unless the clinic has BOUGHT its own look
// (get_booking_widget_credit).
//
// Two halves, as in booking-embed-messages.cy.ts: the database's answer, and
// what the host-page script does with a message. The widget's own report is
// not driven from here, for the reason that spec gives (Cypress rewrites the
// widget's framed check, so under Cypress it reports nothing).

function creditFor(slug: string) {
  return cy.task<{ error: string | null; data: boolean | null }>('db:callRpcAsAnon', { fn: 'get_booking_widget_credit', args: { p_slug: slug } })
}

/** Lets only this spec's messages reach embed.js (see booking-embed-messages.cy.ts). */
function onlyScriptedMessages() {
  cy.window().then((win) => {
    win.addEventListener('message', (event) => {
      const data = event.data as { source?: string, scripted?: boolean } | null
      if (data && data.source === 'quiroflow-booking' && !data.scripted) event.stopImmediatePropagation()
    })
  })
}

function loadEmbedScript() {
  cy.document().then((doc) => {
    const script = doc.createElement('script')
    script.src = '/embed.js'
    doc.body.appendChild(script)
  })
  cy.window().should((win) => {
    const flag = `__quiroflowBookingListener:${win.location.origin}`
    expect((win as unknown as Record<string, unknown>)[flag], 'embed.js listening').to.eq(true)
  })
}

/** Posts from inside the frame, so the message's source is the frame's window. */
function postFromFrame(data: Record<string, unknown>) {
  cy.get<HTMLIFrameElement>('[data-quiroflow-booking] iframe').then(($iframe) => {
    const doc = $iframe[0].contentDocument!
    const script = doc.createElement('script')
    script.textContent = `parent.postMessage(${JSON.stringify({ ...data, scripted: true })}, '*')`
    doc.body.appendChild(script)
  })
}

function embedWidget() {
  cy.document().then((doc) => {
    const container = doc.createElement('div')
    container.setAttribute('data-quiroflow-booking', '')
    container.setAttribute('data-slug', 'embed-test-clinic')
    doc.body.prepend(container)
  })
  loadEmbedScript()
  cy.get<HTMLIFrameElement>('[data-quiroflow-booking] iframe', { timeout: 20000 }).should(($iframe) => {
    const doc = $iframe[0].contentDocument
    expect(doc && doc.location.href, 'frame url').to.contain('/book/')
    expect(doc!.readyState, 'frame loaded').to.eq('complete')
  })
}

describe('Booking widget credit', () => {
  it('is shown unless the clinic bought its own look', () => {
    cy.seedStaffAccount().then((account) => {
      creditFor(account.accountSlug).then((r) => {
        expect(r.error).to.be.null
        expect(r.data, 'a clinic like any other').to.eq(true)
      })

      // Comped is not having paid to take our name off: still shown. Every
      // account get_clinic_branding answered for on 26 Nov 2026 was this.
      cy.setComped(account.accountId, true)
      creditFor(account.accountSlug).then((r) => expect(r.data, 'comped').to.eq(true))
      cy.setComped(account.accountId, false)

      cy.task('db:updateRows', { table: 'subscriptions', values: { branding_addon: true }, match: { account_id: account.accountId } })
      creditFor(account.accountSlug).then((r) => expect(r.data, 'bought the add-on').to.eq(false))

      // A locked account keeps nothing it had bought, the hiding included.
      cy.setSubscriptionStatus(account.accountId, 'locked')
      creditFor(account.accountSlug).then((r) => expect(r.data, 'locked').to.eq(true))
    })
    creditFor('no-such-clinic-code').then((r) => {
      expect(r.error).to.be.null
      expect(r.data, 'unknown slug').to.eq(false)
    })
  })

  it('puts one branded line under the box, in the language the widget says', () => {
    cy.visit('/login')
    onlyScriptedMessages()
    embedWidget()
    cy.get('[data-quiroflow-credit]').should('not.exist')

    postFromFrame({ source: 'quiroflow-booking', height: 700, credit: 'es' })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      const line = $iframe[0].nextElementSibling as HTMLElement | null
      expect(line && line.getAttribute('data-quiroflow-credit')).to.eq('es')
      expect(line!.textContent).to.eq('Reservas online con QuiroFlow')
      // The clinic page's own link, to the marketing site (not the app),
      // with only the brand as its text.
      const link = line!.querySelector('a')!
      expect(link.textContent).to.eq('QuiroFlow')
      expect(link.getAttribute('href')).to.eq('https://quiroflow.com/?utm_source=booking_widget&utm_medium=referral&utm_content=embed-test-clinic')
      expect(link.getAttribute('rel')).to.eq('noopener')
    })

    // Every height report carries it: one line, not one per report.
    postFromFrame({ source: 'quiroflow-booking', height: 720, credit: 'es' })
    postFromFrame({ source: 'quiroflow-booking', height: 740, credit: 'en' })
    cy.get('[data-quiroflow-credit]').should('have.length', 1).and('have.text', 'Online booking by QuiroFlow')
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => expect($iframe[0].style.height).to.eq('740px'))

    // A language it does not know, or false, is no line at all.
    postFromFrame({ source: 'quiroflow-booking', height: 740, credit: 'de' })
    cy.get('[data-quiroflow-credit]').should('not.exist')
    postFromFrame({ source: 'quiroflow-booking', height: 740, credit: 'fr' })
    cy.get('[data-quiroflow-credit]').should('have.text', 'Réservation en ligne avec QuiroFlow')
    postFromFrame({ source: 'quiroflow-booking', height: 740, credit: false })
    cy.get('[data-quiroflow-credit]').should('not.exist')

    // An older widget sends no credit at all: nothing is added or removed.
    postFromFrame({ source: 'quiroflow-booking', height: 760 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => expect($iframe[0].style.height).to.eq('760px'))
    cy.get('[data-quiroflow-credit]').should('not.exist')
  })
})
