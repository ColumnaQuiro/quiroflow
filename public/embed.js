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
 * It also passes on the page's own language, as ?site_lang=, so a clinic
 * whose site is in Spanish and English can show the booking in whichever the
 * patient is reading -- columnaquiro.com's /reserva-cita/ and
 * /en/book-appointment/ embedded the same iframe, and the English page booked
 * in Spanish unless the browser said otherwise.
 *
 * A hint, not ?lang=: the widget follows it only for a clinic that has hidden
 * its language picker (Settings > Online booking > Look), which is the clinic
 * saying its site decides. Plenty of WordPress sites still declare the theme's
 * default `<html lang="en-US">` over Spanish content, and taken as an order
 * that would put every patient of a clinic that never touched a setting into
 * English. With the picker shown, the widget goes on following the browser.
 *
 * And it listens to the widget (onMessage, below): the frame reports its
 * height so the box fits the step it is showing, and when a booking completes
 * with a thank-you page configured, that page opens on the clinic's site
 * rather than inside the box.
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
   * A built iframe's size before the widget has said how tall it is: enough
   * for the calendar on a phone without an inner scrollbar. Marked with
   * DEFAULT_FLOOR so the first height report can lift it.
   */
  var DEFAULT_HEIGHT = '780px'
  var DEFAULT_FLOOR = 'data-quiroflow-default-height'

  /**
   * The tallest the widget may make its box. Its longest step on a narrow
   * phone, with a long service list, is a few thousand pixels; this is only
   * there so a runaway report (a layout loop, a bug) cannot push the rest of
   * the clinic's page tens of thousands of pixels down.
   */
  var MAX_HEIGHT = 12000

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
   * The parent page's language, when it is one the widget speaks
   * (utils/bookingLanguage.ts: es, en, fr). `<html lang="en-GB">` -> 'en'.
   * Anything else, or nothing, is left for the widget to work out from the
   * browser, as it did before.
   */
  var LANGUAGES = ['es', 'en', 'fr']
  function languageOfTag(tag) {
    var primary = String(tag || '').trim().toLowerCase().split(/[-_]/)[0]
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i] === primary) return primary
    }
    return null
  }
  function pageLanguage() {
    return languageOfTag(document.documentElement.getAttribute('lang'))
  }

  /**
   * What the widget picks with no ?lang= (bookingLanguageFromList): the
   * first of the browser's languages it speaks, else Spanish. When this is
   * already the page's language, ?site_lang= could change nothing, and an
   * existing iframe is not reloaded to say it.
   */
  function browserLanguage() {
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]
    for (var i = 0; i < tags.length; i++) {
      var lang = languageOfTag(tags[i])
      if (lang) return lang
    }
    return 'es'
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
   * Full width; the height follows the widget's own reports (onMessage), with
   * data-height as a floor for a clinic that wants the box never shorter.
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
    // Until the widget reports its height (onMessage), this is the box's
    // size. A data-height stays as the floor after that; the default only
    // stands in for a report that has not arrived, so it is dropped then.
    var floor = container.getAttribute('data-height')
    iframe.style.minHeight = floor || DEFAULT_HEIGHT
    if (!floor) iframe.setAttribute(DEFAULT_FLOOR, '')
    iframe.style.border = '0'
    container.appendChild(iframe)
  }

  /** The <iframe> element whose window sent a message, if it is one of ours. */
  function bookingFrameFor(source) {
    if (!source) return null
    var iframes = document.getElementsByTagName('iframe')
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow !== source) continue
      // The src as written on the page, not wherever the frame is now: an
      // iframe the clinic pasted pointing at /book/… counts whether or not
      // upgradeIframe touched it (it does not, for an organic visit).
      return isBookingUrl(iframes[i].getAttribute('src') || '') ? iframes[i] : null
    }
    return null
  }

  function resize(iframe, height) {
    // typeof, then a range: NaN and Infinity fail one or the other.
    if (typeof height !== 'number' || !(height > 0) || height === Infinity) return
    iframe.style.height = Math.min(Math.ceil(height), MAX_HEIGHT) + 'px'
    if (iframe.hasAttribute(DEFAULT_FLOOR)) {
      iframe.removeAttribute(DEFAULT_FLOOR)
      iframe.style.minHeight = ''
    }
  }

  var redirected = false

  /**
   * The clinic's thank-you page, opened on its own site.
   *
   * The widget offers this first and then, a moment later, navigates the
   * frame itself, because a page without this script would otherwise get no
   * thank-you page at all. Answering with redirect_taken cancels that, so the
   * page loads once -- on the top window, where its conversion tags see the
   * visitor's own cookies -- and not a second time inside the box.
   *
   * http(s) is the only check on the destination, and deliberately the only
   * one. The url is the clinic's "Página de agradecimiento" (Settings >
   * Online booking), which is its own site but under any domain it likes --
   * a landing-page builder, a second brand -- so there is no host this could
   * hold it to. What makes it trustworthy is where it came from: a message
   * from our origin, sent by a booking frame on this page, which the widget
   * built from the clinic's own setting. The protocol check is what keeps a
   * javascript: url out of window.location whatever that frame says.
   */
  function redirect(source, url) {
    if (redirected || typeof url !== 'string') return
    var target
    try {
      target = new URL(url)
    } catch (e) {
      return
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return
    redirected = true
    try {
      source.postMessage({ source: 'quiroflow-embed', event: 'redirect_taken' }, ORIGIN)
    } catch (e) {
      /* the frame shows its own thank-you page instead; nothing lost */
    }
    window.location.href = target.href
  }

  /**
   * What the widget (pages/book/[slug].vue) sends to its parent:
   *   { source: 'quiroflow-booking', height }            on mount and resize
   *   { source: 'quiroflow-booking', event: 'booking_completed', url }
   *
   * Accepted only from our own origin, and only from a booking iframe on this
   * page: any other frame here (an ad, a chat widget, a second embed from
   * somewhere else) could otherwise resize the box or send the visitor away.
   */
  function onMessage(event) {
    if (event.origin !== ORIGIN) return
    var data = event.data
    if (!data || typeof data !== 'object' || data.source !== 'quiroflow-booking') return
    var iframe = bookingFrameFor(event.source)
    if (!iframe) return
    if (data.event === 'booking_completed') redirect(event.source, data.url)
    else if (data.height !== undefined) resize(iframe, data.height)
  }

  function run() {
    var params = campaignParams()
    var hasCampaign = false
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) hasCampaign = true
    }
    // Carried like a campaign param (withParams: a value already on the
    // iframe wins). The widget gives a ?lang= of the clinic's own precedence
    // over it anyway.
    var lang = pageLanguage()
    if (lang) params.site_lang = lang

    // A new iframe costs nothing to build with every key on it.
    var containers = document.querySelectorAll('[data-quiroflow-booking]')
    for (var i = 0; i < containers.length; i++) buildIframe(containers[i], params)

    // An existing one is reloaded by a rewrite, so only for something the
    // widget could not see by itself: a campaign, or a page language other
    // than the one the browser would give it anyway. An organic visit in
    // the browser's own language leaves the embeds exactly as they are.
    if (!hasCampaign && (!lang || lang === browserLanguage())) return

    var iframes = document.getElementsByTagName('iframe')
    // Live HTMLCollection, and upgradeIframe can append nothing to it — but
    // buildIframe above already ran, so snapshot the length first regardless.
    var count = iframes.length
    for (var j = 0; j < count; j++) upgradeIframe(iframes[j], params)
  }

  // One listener per page however many times the script is included (a
  // theme plus a page builder, say), keyed by origin so a staging copy and a
  // production copy on the same test page each still hear their own frames.
  var LISTENING = '__quiroflowBookingListener:' + ORIGIN
  if (!window[LISTENING]) {
    window[LISTENING] = true
    window.addEventListener('message', onMessage)
  }

  // Once as early as possible, for embeds already parsed above this tag, and
  // again when the document is complete for anything below it. Both passes
  // are idempotent via MARK.
  run()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  }
})()
