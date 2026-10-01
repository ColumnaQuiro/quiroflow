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
// Inside the Capacitor app none of that applies and the pre-opened tab would
// do harm: the native shell hands any window.open to the system browser, and
// an empty one would arrive there as about:blank. There the URL is opened
// once it is known, which is how the app has always done it.

type Opener = Pick<Window, 'open'> & { Capacitor?: { isNativePlatform?: () => boolean } }

export async function openWhenReady(
  resolveUrl: () => Promise<string | null | undefined>,
  win: Opener = window,
): Promise<boolean> {
  if (win.Capacitor?.isNativePlatform?.()) {
    const url = await resolveUrl()
    if (url) win.open(url, '_blank')
    return !!url
  }

  const tab = win.open('', '_blank')
  let url: string | null | undefined
  try {
    url = await resolveUrl()
  } catch (err) {
    tab?.close()
    throw err
  }
  if (!url) {
    tab?.close()
    return false
  }
  // A blocker that refused even the synchronous open leaves no tab; trying
  // again costs nothing and is what this did before.
  if (tab) tab.location.href = url
  else win.open(url, '_blank')
  return true
}
