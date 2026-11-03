import { describe, it, expect, vi, afterEach } from 'vitest'
import { warmChunks } from '../../utils/warmChunks'

// A warm-up that fails on a tab left open across a release must not surface
// as an unhandled rejection: that is what filled JAVASCRIPT-NUXT-6 and -C with
// reports of panels nobody had opened.

describe('warmChunks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts every load once the browser is idle', () => {
    let idle: (() => void) | undefined
    vi.stubGlobal('window', { requestIdleCallback: (cb: () => void) => { idle = cb } })
    const load = vi.fn(() => [Promise.resolve(), Promise.resolve()])
    warmChunks(load)
    expect(load).not.toHaveBeenCalled()
    idle!()
    expect(load).toHaveBeenCalledOnce()
  })

  it('falls back to a timer where there is no idle callback', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const load = vi.fn(() => [Promise.resolve()])
    warmChunks(load)
    vi.advanceTimersByTime(1500)
    expect(load).toHaveBeenCalledOnce()
  })

  it('swallows a chunk that fails to load', async () => {
    let idle: (() => void) | undefined
    vi.stubGlobal('window', { requestIdleCallback: (cb: () => void) => { idle = cb } })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      warmChunks(() => [Promise.reject(new TypeError('Failed to fetch dynamically imported module'))])
      idle!()
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
