import { describe, it, expect } from 'vitest'
import { isChunkLoadError, newerBuildIsLive } from '../../utils/sentryStaleChunk'

// utils/sentryStaleChunk.ts: a lazy chunk from a build that has since been
// replaced is dropped from Sentry; any other chunk failure is not.

describe('isChunkLoadError', () => {
  it('knows each browser wording', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://app.quiroflow.com/_nuxt/CgcQ_Z22.js'))).to.eq(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).to.eq(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://app.quiroflow.com/_nuxt/x.js'))).to.eq(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /_nuxt/x.css'))).to.eq(true)
  })

  it('looks through a wrapper to its cause, as h3 createError wraps it', () => {
    const wrapped = Object.assign(new Error('wrapped'), { cause: new TypeError('Importing a module script failed.') })
    expect(isChunkLoadError(wrapped)).to.eq(true)
  })

  it('leaves everything else alone', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).to.eq(false)
    expect(isChunkLoadError(new Error('Cannot read properties of null'))).to.eq(false)
    expect(isChunkLoadError(null)).to.eq(false)
    expect(isChunkLoadError(undefined)).to.eq(false)
  })
})

describe('newerBuildIsLive', () => {
  it('is true only when the live build is a different one', async () => {
    expect(await newerBuildIsLive('a', async () => ({ id: 'b' }))).to.eq(true)
    expect(await newerBuildIsLive('a', async () => ({ id: 'a' })), 'the tab is current: a real failure').to.eq(false)
  })

  it('reports when it cannot tell', async () => {
    expect(await newerBuildIsLive('a', async () => { throw new Error('offline') })).to.eq(false)
    expect(await newerBuildIsLive('a', async () => null)).to.eq(false)
    expect(await newerBuildIsLive('a', async () => ({}))).to.eq(false)
  })
})
