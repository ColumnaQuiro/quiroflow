/**
 * QuiroFlow booking embed — carries campaign attribution across the iframe.
 *
 * The booking widget reads gclid/utm_* from its own query string
 * (pages/book/[slug].vue, captureAttribution). That works when someone opens
 * /book/SLUG directly, and fails silently the moment a clinic embeds it: the
 * landing page's `?gclid=…` is on the PARENT url, and an iframe src does not
 * inherit it. The widget then captures an empty params object and the
 * booking is recorded as though it came from nowhere.
 *
 * Measured on columnaquiro.com before this existed: 7 public bookings, 0 with
 * a click id, 0 with any utm, every landing_path just
 * `/book/columnaquiro?type=…` — the iframe's own url. Google Ads had sent 48
 * paid clicks to the page in the same window and reported conversions for
 * them. Both halves were right; nothing joined them.
 *
 * This runs on the parent page, where the params still exist, and puts them
 * on the iframe url the widget does read. Two ways in, and one pass handles
 * both:
 *
 *   1. An <iframe> already pointing at /book/… has its src rewritten in
 *      place. A clinic that embedded the widget months ago adds this one
 *      script tag and changes nothing else — which is the whole reason the
 *      rewrite path exists.
 *
 *   2. <div data-quiroflow-booking data-slug="…" data-type="…"></div> has the
 *      iframe built for it, for clinics embedding it for the first time.
 *
 * Deliberately ES5 and dependency-free: it runs on whatever a clinic's site
 * is built with, which in practice means WordPress themes of unknown vintage.
 */
(function () {
  'use strict'

  /**
   * Forwarded verbatim; everything else on the parent url is left alone.
   *
   * An allowlist rather than "copy the query string", because a clinic's
   * landing page url is not ours and may legitimately carry things that must
   * not be replayed into another origin's url — a session token in a link
   * from an email, a prefilled email address, an affiliate's id. The widget
   * reads exactly these keys and ignores anything else, so forwarding more
   * would add risk and buy nothing.
   *
   * gbraid/wbraid are Google's stand-ins for gclid when the click cannot be
   * cookied (iOS app-to-web, mostly). Traffic to a clinic's offer page is
   * mostly phones, so leaving them out would drop attribution for a real
   * slice of exactly the visitors this is meant to catch.
   */
  var FORWARDED = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
    'gbraid',
    'wbraid',
    'ttclid',
    'msclkid',
  ]

  /** Already-processed iframes carry this, so a second run is a no-op. */
  var MARK = 'data-quiroflow-attributed'

  /**
   * The origin this script was served from, so a staging or self-hosted
   * deploy rewrites its own iframes and not app.quiroflow.com's. Falls back to
   * production for the case where currentScript is unavailable (an old
   * browser, or the tag injected by a tag manager that strips it).
   */
  function scriptOrigin() {
    var el = document.currentScript
    if (!el && document.scripts.length) {
      // Last script in the document is us while the document is still
      // parsing, which is when this runs in the normal case.
      el = document.scripts[document.scripts.length - 1]
    }
    try {
      if (el && el.src) return new URL(el.src).origin
    } catch (e) {
      /* falls through */
    }
    return 'https://app.quiroflow.com'
  }

  var ORIGIN = scriptOrigin()

  /**
   * The parent page's campaign params, keyed as the widget expects them.
   *
   * Keys are trimmed and lowercased before matching, for the same reason the
   * widget does it: hand-built ad urls are not clean. The live Meta ad points
   * at `…?+utm_campaign=ad_imagen`, where the `+` straight after the `?`
   * decodes to a space and the parameter is really named " utm_campaign".
   * Normalising here as well means the fix is not undone by being read on
   * this side of the boundary first.
   */
  function campaignParams() {
    var found = {}
    var search = window.location.search
    if (!search || search.length < 2) return found

    var normalised = {}
    var pairs = search.replace(/^\?/, '').split('&')
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue
      var eq = pairs[i].indexOf('=')
      var rawKey = eq === -1 ? pairs[i] : pairs[i].slice(0, eq)
      var rawValue = eq === -1 ? '' : pairs[i].slice(eq + 1)
      var key, value
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' ')).trim().toLowerCase()
        value = decodeURIComponent(rawValue.replace(/\+/g, ' ')).trim()
      } catch (e) {
        // A malformed escape sequence anywhere in the query string must not
        // take the booking widget down with it.
        continue
      }
      if (key && value) normalised[key] = value
    }

    for (var j = 0; j < FORWARDED.length; j++) {
      var name = FORWARDED[j]
      if (normalised[name]) found[name] = normalised[name]
    }
    return found
  }

  /**
   * Adds the params to a /book/ url without disturbing what is already there.
   *
   * Existing keys win: `type` selects the appointment type and is the whole
   * point of the embed, and a clinic that hand-wrote a utm onto its own
   * iframe meant it. This only fills in what the parent knows and the iframe
   * does not.
   */
  function withParams(url, params) {
    var parsed
    try {
      parsed = new URL(url, ORIGIN)
    } catch (e) {
      return null
    }
    var added = false
    for (var key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue
      if (parsed.searchParams.has(key)) continue
      parsed.searchParams.set(key, params[key])
      added = true
    }
    return added ? parsed.toString() : null
  }

  function isBookingUrl(url) {
    try {
      var parsed = new URL(url, ORIGIN)
      return parsed.origin === ORIGIN && parsed.pathname.indexOf('/book/') === 0
    } catch (e) {
      return false
    }
  }

  /**
   * Rewrites an existing embed's src.
   *
   * Assigning src reloads the iframe, so this wants to happen before it has
   * loaded — which is why the script is meant to sit next to the embed rather
   * than at the end of the body. When it does land late the cost is one extra
   * load of a widget that has not been interacted with yet; the alternative
   * is losing the campaign, which is the thing being fixed.
   */
  function upgradeIframe(iframe, params) {
    if (iframe.hasAttribute(MARK)) return
    var src = iframe.getAttribute('src')
    if (!src || !isBookingUrl(src)) return
    iframe.setAttribute(MARK, '')
    var next = withParams(src, params)
    if (next) iframe.setAttribute('src', next)
  }

  /**
   * Builds an iframe for the declarative form.
   *
   * The sizing matches what the widget needs to render its calendar without
   * an inner scrollbar on a phone; a clinic can override either with a style
   * attribute on the container.
   */
  function buildIframe(container, params) {
    if (container.hasAttribute(MARK)) return
    container.setAttribute(MARK, '')

    var slug = container.getAttribute('data-slug')
    if (!slug) {
      // Nothing useful to render, and a silent empty box on a clinic's live
      // landing page is worse than a line in their console.
      if (window.console && console.warn) {
        console.warn('[quiroflow] <div data-quiroflow-booking> needs a data-slug attribute.')
      }
      return
    }

    var url = ORIGIN + '/book/' + encodeURIComponent(slug)
    var type = container.getAttribute('data-type')
    if (type) url += '?type=' + encodeURIComponent(type)

    var iframe = document.createElement('iframe')
    iframe.setAttribute('src', withParams(url, params) || url)
    iframe.setAttribute('title', container.getAttribute('data-title') || 'Reserva de cita')
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('allow', 'payment')
    iframe.setAttribute(MARK, '')
    iframe.style.width = '100%'
    iframe.style.minHeight = container.getAttribute('data-height') || '780px'
    iframe.style.border = '0'
    container.appendChild(iframe)
  }

  function run() {
    var params = campaignParams()

    var containers = document.querySelectorAll('[data-quiroflow-booking]')
    for (var i = 0; i < containers.length; i++) buildIframe(containers[i], params)

    // Nothing to forward means nothing to rewrite: an organic visit should
    // leave the existing embeds exactly as they are rather than reloading
    // them to add no information.
    var hasParams = false
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) hasParams = true
    }
    if (!hasParams) return

    var iframes = document.getElementsByTagName('iframe')
    // Live HTMLCollection, and upgradeIframe can append nothing to it — but
    // buildIframe above already ran, so snapshot the length first regardless.
    var count = iframes.length
    for (var j = 0; j < count; j++) upgradeIframe(iframes[j], params)
  }

  // Once as early as possible, for embeds already parsed above this tag, and
  // again when the document is complete for anything below it. Both passes
  // are idempotent via MARK.
  run()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  }
})()
