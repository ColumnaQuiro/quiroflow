import { describe, it, expect } from 'vitest'
import { openWhenReady } from '../../utils/openWhenReady'

// Safari on an iPad only opens a tab during the tap itself, so the tab has to
// be opened before the signed URL is awaited, not after.

function fakeWindow(opts: { native?: boolean; blocked?: boolean } = {}) {
  const calls: string[] = []
  const navigations: string[] = []
  const tab = { closed: false, location: { href: '' }, close() { this.closed = true } }
  const win = {
    open(url?: string | URL) {
      calls.push(String(url ?? ''))
      return opts.blocked ? null : (tab as unknown as Window)
    },
    location: { assign: (url: string | URL) => navigations.push(String(url)) },
    Capacitor: opts.native ? { isNativePlatform: () => true } : undefined,
  }
  return { win, calls, navigations, tab }
}

describe('openWhenReady', () => {
  it('opens the tab before the URL resolves, then points it there', async () => {
    const { win, calls, tab } = fakeWindow()
    let release!: (url: string) => void
    const pending = openWhenReady(() => new Promise<string>((r) => (release = r)), win)
    expect(calls).to.deep.equal([''])
    release('https://example.test/file.pdf')
    expect(await pending).to.equal(true)
    expect(tab.location.href).to.equal('https://example.test/file.pdf')
    expect(calls).to.deep.equal([''])
  })

  it('closes the empty tab when there is no URL', async () => {
    const { win, tab } = fakeWindow()
    expect(await openWhenReady(async () => null, win)).to.equal(false)
    expect(tab.closed).to.equal(true)
  })

  it('closes the empty tab and rethrows when signing fails', async () => {
    const { win, tab } = fakeWindow()
    await expect(openWhenReady(async () => Promise.reject(new Error('nope')), win)).rejects.toThrow('nope')
    expect(tab.closed).to.equal(true)
  })

  it('tries once more with the URL when even the first open was refused', async () => {
    const { win, calls } = fakeWindow({ blocked: true })
    await openWhenReady(async () => 'https://example.test/a.png', win)
    expect(calls).to.deep.equal(['', 'https://example.test/a.png'])
  })

  it('navigates to the URL inside the native app rather than opening a window', async () => {
    // iOS's WebKit drops a window.open that arrives after the tap, so the
    // iPhone app could list a shared document and never open it. Capacitor
    // hands a navigation to an outside address to the system browser instead.
    const { win, calls, navigations } = fakeWindow({ native: true })
    expect(await openWhenReady(async () => 'https://example.test/a.pdf', win)).to.equal(true)
    expect(navigations).to.deep.equal(['https://example.test/a.pdf'])
    expect(calls).to.deep.equal([])
  })

  it('never navigates the app to one of its own paths', async () => {
    const { win, calls, navigations } = fakeWindow({ native: true })
    await openWhenReady(async () => '/documents/a.pdf', win)
    expect(navigations).to.deep.equal([])
    expect(calls).to.deep.equal(['/documents/a.pdf'])
  })

  it('never sends the same-origin tab to a javascript: URL', async () => {
    // An exercise's video link is stored data; assigned to the empty tab, a
    // javascript: URL would run on the app's origin with the patient's session.
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
      const { win, calls, tab } = fakeWindow()
      expect(await openWhenReady(async () => url, win)).to.equal(false)
      expect(tab.location.href).to.equal('')
      expect(tab.closed).to.equal(true)
      expect(calls).to.deep.equal([''])
    }
  })

  it('opens nothing for a javascript: URL in the native app either', async () => {
    const { win, calls, navigations } = fakeWindow({ native: true })
    expect(await openWhenReady(async () => 'javascript:alert(1)', win)).to.equal(false)
    expect(navigations).to.deep.equal([])
    expect(calls).to.deep.equal([])
  })

  it('still opens the app own paths and http(s) links', async () => {
    for (const url of ['/api/portal/x.pdf', 'https://maps.apple.com/?q=a', 'http://example.test/a']) {
      const { win, tab } = fakeWindow()
      expect(await openWhenReady(async () => url, win)).to.equal(true)
      expect(tab.location.href).to.equal(url)
    }
  })

  it('does nothing in the native app when there is no URL', async () => {
    const { win, calls, navigations } = fakeWindow({ native: true })
    expect(await openWhenReady(async () => null, win)).to.equal(false)
    expect(navigations).to.deep.equal([])
    expect(calls).to.deep.equal([])
  })
})
