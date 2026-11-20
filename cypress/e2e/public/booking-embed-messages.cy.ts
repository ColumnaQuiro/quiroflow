// public/embed.js, the half that listens: the booking widget reports its
// height and a completed booking to the page it is embedded in, and the
// script sizes the box and opens the clinic's thank-you page on top.
//
// Until this existed nothing on the host side listened, so every embedded
// booking page was a 780 px box with a scrollbar of its own, and a clinic's
// thank-you page -- the one carrying its conversion tags -- opened inside
// that box. Same approach as booking-embed-attribution.cy.ts: the real
// script, served by the app, on a host page built inside the app origin,
// with the real widget in the frame.
//
// The messages themselves are scripted from inside that frame rather than
// left to the widget. Cypress rewrites frame-busting code in the app's own
// JavaScript (modifyObstructiveCode), and `window.self !== window.top` is
// exactly the pattern it rewrites -- so under Cypress the widget believes it
// is not framed and reports nothing. Its half (measuring its content,
// cancelling its own redirect on redirect_taken) was checked by hand against
// a host page on another origin. What this pins is the half a clinic's page
// runs: which messages it acts on, and what it does with them.

const BOOKING_SRC = '/book/embed-test-clinic'

/**
 * Lets only this spec's messages reach embed.js.
 *
 * Registered before the script, so it runs first and can stop the rest. If
 * Cypress ever stops rewriting the widget's framed check, the widget's own
 * reports would otherwise race the heights asserted here.
 */
function onlyScriptedMessages() {
  cy.window().then((win) => {
    win.addEventListener('message', (event) => {
      const data = event.data as { source?: string, scripted?: boolean } | null
      if (data && data.source === 'quiroflow-booking' && !data.scripted) event.stopImmediatePropagation()
    })
  })
}

/** Injects embed.js into the page under test. */
function loadEmbedScript() {
  cy.document().then((doc) => {
    const script = doc.createElement('script')
    script.src = '/embed.js'
    doc.body.appendChild(script)
  })
  // Loaded asynchronously: a frame that is already on the page could post
  // before anything is listening.
  cy.window().should((win) => {
    const flag = `__quiroflowBookingListener:${win.location.origin}`
    expect((win as unknown as Record<string, unknown>)[flag], 'embed.js listening').to.eq(true)
  })
}

/**
 * Posts `data` to the host page FROM the frame, the way the widget does.
 *
 * Run as a script inside the frame's own document, so the message's source
 * is the frame's window -- calling parent.postMessage from the spec would
 * make the spec the sender, and embed.js rightly ignores that.
 */
function postFromFrame(selector: string, data: Record<string, unknown>) {
  cy.get<HTMLIFrameElement>(selector).then(($iframe) => {
    const doc = $iframe[0].contentDocument!
    const script = doc.createElement('script')
    script.textContent = `parent.postMessage(${JSON.stringify({ ...data, scripted: true })}, '*')`
    doc.body.appendChild(script)
  })
}

/** A built embed, first on the page so a lazy iframe is in view and loads. */
function addContainer(attrs: Record<string, string> = {}) {
  cy.document().then((doc) => {
    const container = doc.createElement('div')
    container.setAttribute('data-quiroflow-booking', '')
    container.setAttribute('data-slug', 'embed-test-clinic')
    for (const [name, value] of Object.entries(attrs)) container.setAttribute(name, value)
    doc.body.prepend(container)
  })
}

/**
 * Waits until a frame has loaded, so a script can run inside it. A new
 * iframe starts on an about:blank that is already "complete", so a booking
 * frame is waited for by its path, not just its readyState.
 */
function loadedFrame(selector: string, path = '/book/') {
  return cy.get<HTMLIFrameElement>(selector, { timeout: 20000 }).should(($iframe) => {
    const doc = $iframe[0].contentDocument
    expect(doc && doc.location.href, 'frame url').to.contain(path)
    expect(doc!.readyState, 'frame loaded').to.eq('complete')
  })
}

describe('Booking embed messages', () => {
  it('sizes a built embed to the widget, not to a fixed 780 px box', () => {
    cy.visit('/login')
    onlyScriptedMessages()
    addContainer()
    loadEmbedScript()

    // Before any report, the box is the old fixed size.
    loadedFrame('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.minHeight).to.eq('780px')
    })
    // A step shorter than that: the box follows it down, because the default
    // floor only stood in for a report that had not arrived yet.
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: 640.4 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('641px')
      expect($iframe[0].style.minHeight).to.eq('')
      expect($iframe[0].clientHeight).to.eq(641)
    })
    // Nonsense is ignored rather than collapsing the box.
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: -5 })
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: '900' })
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: 702 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('702px')
    })
  })

  it('keeps data-height as a floor, not a cap', () => {
    cy.visit('/login')
    onlyScriptedMessages()
    addContainer({ 'data-height': '1100px' })
    loadEmbedScript()

    loadedFrame('[data-quiroflow-booking] iframe')
    // Shorter than the floor: the floor stays.
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: 600 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('600px')
      expect($iframe[0].style.minHeight).to.eq('1100px')
      expect($iframe[0].clientHeight).to.eq(1100)
    })
    // Taller than the floor: the report wins.
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: 1500 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('1500px')
      expect($iframe[0].style.minHeight).to.eq('1100px')
    })
  })

  it('resizes an iframe the clinic pasted by hand, and caps a runaway height', () => {
    // An organic visit: upgradeIframe leaves this iframe alone, and resizing
    // must not depend on it having run.
    cy.visit('/login')
    onlyScriptedMessages()
    cy.document().then((doc) => {
      const iframe = doc.createElement('iframe')
      iframe.id = 'hand-pasted'
      iframe.setAttribute('src', BOOKING_SRC)
      iframe.setAttribute('height', '500')
      doc.body.prepend(iframe)
    })
    loadEmbedScript()

    loadedFrame('#hand-pasted')
    postFromFrame('#hand-pasted', { source: 'quiroflow-booking', height: 950 })
    cy.get('#hand-pasted').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('950px')
    })
    cy.get('#hand-pasted').should('not.have.attr', 'data-quiroflow-attributed')

    postFromFrame('#hand-pasted', { source: 'quiroflow-booking', height: 999999 })
    cy.get('#hand-pasted').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('12000px')
    })
  })

  it('ignores a frame on the page that is not a booking embed', () => {
    // about:blank inherits the host's origin, so the origin check alone would
    // let it through: what stops it is not being a booking iframe.
    cy.visit('/login')
    onlyScriptedMessages()
    addContainer()
    cy.document().then((doc) => {
      const other = doc.createElement('iframe')
      other.id = 'not-booking'
      doc.body.prepend(other)
    })
    loadEmbedScript()

    loadedFrame('[data-quiroflow-booking] iframe')
    loadedFrame('#not-booking', 'about:blank')
    postFromFrame('#not-booking', { source: 'quiroflow-booking', height: 4321 })
    postFromFrame('#not-booking', {
      source: 'quiroflow-booking',
      event: 'booking_completed',
      url: `${Cypress.config('baseUrl')}/login?hijacked=1`,
    })
    // A message the script DOES act on, sent last, so seeing it applied
    // proves the two before it were processed and dropped.
    postFromFrame('[data-quiroflow-booking] iframe', { source: 'quiroflow-booking', height: 1234 })
    cy.get('[data-quiroflow-booking] iframe').should(($iframe) => {
      expect($iframe[0].style.height).to.eq('1234px')
    })
    cy.get<HTMLIFrameElement>('#not-booking').should(($other) => {
      expect($other[0].style.height).to.eq('')
    })
    cy.location('search').should('eq', '')
  })

  it('opens the thank-you page on the host page, once, and tells the frame', () => {
    cy.visit('/login')
    onlyScriptedMessages()
    addContainer()
    // Included twice, as a theme plus a page builder would: one listener.
    loadEmbedScript()
    loadEmbedScript()

    loadedFrame('[data-quiroflow-booking] iframe')
    cy.window().then((win) => win.sessionStorage.removeItem('embed-acks'))
    // Records what the host sends back, in the frame's own realm. Session
    // storage is shared with the host page (same origin here) and survives
    // the navigation, so it can be read after the redirect.
    cy.get<HTMLIFrameElement>('[data-quiroflow-booking] iframe').then(($iframe) => {
      const doc = $iframe[0].contentDocument!
      const script = doc.createElement('script')
      script.textContent = `window.addEventListener('message', function (e) {
        if (!e.data || e.data.source !== 'quiroflow-embed') return
        var acks = JSON.parse(sessionStorage.getItem('embed-acks') || '[]')
        acks.push(e.data.event)
        sessionStorage.setItem('embed-acks', JSON.stringify(acks))
      })`
      doc.body.appendChild(script)
    })

    // Not http(s): never reaches window.location.
    postFromFrame('[data-quiroflow-booking] iframe', {
      source: 'quiroflow-booking',
      event: 'booking_completed',
      url: 'javascript:document.title="pwned"',
    })
    postFromFrame('[data-quiroflow-booking] iframe', {
      source: 'quiroflow-booking',
      event: 'booking_completed',
      url: `${Cypress.config('baseUrl')}/login?booking=thanks`,
    })

    cy.location('search').should('eq', '?booking=thanks')
    cy.title().should('not.eq', 'pwned')
    cy.window().then((win) => {
      expect(JSON.parse(win.sessionStorage.getItem('embed-acks') || '[]')).to.deep.eq(['redirect_taken'])
    })
  })
})
