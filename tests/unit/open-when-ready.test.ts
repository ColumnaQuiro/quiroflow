import { describe, it, expect } from 'vitest'
import { openWhenReady } from '../../utils/openWhenReady'

// Safari on an iPad only opens a tab during the tap itself, so the tab has to
// be opened before the signed URL is awaited, not after.

function fakeWindow(opts: { native?: boolean; blocked?: boolean } = {}) {
  const calls: string[] = []
  const tab = { closed: false, location: { href: '' }, close() { this.closed = true } }
  const win = {
    open(url?: string | URL) {
      calls.push(String(url ?? ''))
      return opts.blocked ? null : (tab as unknown as Window)
    },
    Capacitor: opts.native ? { isNativePlatform: () => true } : undefined,
  }
  return { win, calls, tab }
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

  it('opens only the URL inside the native app', async () => {
    const { win, calls } = fakeWindow({ native: true })
    await openWhenReady(async () => 'https://example.test/a.png', win)
    expect(calls).to.deep.equal(['https://example.test/a.png'])
  })
})
