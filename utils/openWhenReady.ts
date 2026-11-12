// Opens, in a new tab, a URL that only exists once a request has come back --
// a signed storage link, a PDF link from the server.
//
// The obvious way, `const url = await sign(); window.open(url, '_blank')`,
// works on a desktop browser and does nothing at all on an iPad. Safari only
// lets a page open a tab while it is still handling the tap that asked for
// it, and an await ends that. The popup blocker then refuses the open without
// a message, so on a tablet Preview and Download on a patient's files simply
// did nothing. Chrome on desktop allows a few seconds of grace after the
// click, which is why it was never seen there.
//
// So the tab is opened first, empty, while the tap still counts, and sent to
// the URL once it is known. When there is no URL it is closed again, so a
// failure does not leave a blank tab behind.
//
// Inside the Capacitor app a tab is the wrong tool altogether. On iOS the
// shell only hears about a window.open that WebKit lets through, and WebKit
// refuses one that arrives after the tap the same way Safari does: Capacitor
// never turns on javaScriptCanOpenWindowsAutomatically. So `await sign();
// window.open(url)` did nothing in the iPhone app either -- a patient could
// see a document the clinic shared and could not open it (reported 1 Oct
// 2026). A pre-opened empty tab is no better: it would reach Safari as
// about:blank.
//
// What does work is navigating the app's own page to the URL. Capacitor
// cancels any top-level navigation to an address outside the app and hands it
// to the system browser (iOS and Android alike), and that path does not care
// whether a tap is still in progress. The page itself never moves. Only an
// absolute URL is outside the app; anything else would navigate the app away
// from itself, so it keeps the old window.open.

//
// Only a web address is opened: http(s), or one of the app's own paths.
// Some URLs reach here as data -- an exercise's video link is whatever the
// clinic stored in exercises.media_url -- and the empty tab below is
// same-origin with the app, so `tab.location.href = 'javascript:...'` would
// run that script with the patient's session. Parsed with URL rather than
// tested with a regex because the parser is what the browser applies: it
// drops the tabs, newlines and leading spaces a regex would have to know
// about ("java\tscript:").

type Opener = Pick<Window, 'open'> & {
  location?: Pick<Location, 'assign'>
  Capacitor?: { isNativePlatform?: () => boolean }
}

export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url, 'https://app.invalid/')
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export async function openWhenReady(
  resolveUrl: () => Promise<string | null | undefined>,
  win: Opener = window,
): Promise<boolean> {
  if (win.Capacitor?.isNativePlatform?.()) {
    const url = await resolveUrl()
    if (!url || !isWebUrl(url)) return false
    if (/^https?:\/\//i.test(url) && win.location) win.location.assign(url)
    else win.open(url, '_blank')
    return true
  }

  const tab = win.open('', '_blank')
  let url: string | null | undefined
  try {
    url = await resolveUrl()
  } catch (err) {
    tab?.close()
    throw err
  }
  if (!url || !isWebUrl(url)) {
    tab?.close()
    return false
  }
  // A blocker that refused even the synchronous open leaves no tab; trying
  // again costs nothing and is what this did before.
  if (tab) tab.location.href = url
  else win.open(url, '_blank')
  return true
}
