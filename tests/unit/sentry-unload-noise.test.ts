import { describe, it, expect } from 'vitest'
import { UNLOAD_WINDOW_MS, isUnloadSecurityError } from '../../utils/sentryUnloadNoise'

// utils/sentryUnloadNoise.ts: vue-router's scroll save refused by Firefox as
// the page closes (JAVASCRIPT-NUXT-R) is dropped; nothing else is.

const securityError = Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' })

describe('Sentry unload noise', () => {
  it('drops a SecurityError raised while the page is closing', () => {
    expect(isUnloadSecurityError(securityError, 1000, 1005)).to.eq(true)
  })

  it('keeps the same error when the page is not closing', () => {
    // e.g. localStorage blocked in a third-party frame: same message, real failure.
    expect(isUnloadSecurityError(securityError, null, 1005)).to.eq(false)
  })

  it('keeps it once the unload has been cancelled and time has passed', () => {
    expect(isUnloadSecurityError(securityError, 1000, 1000 + UNLOAD_WINDOW_MS + 1)).to.eq(false)
  })

  it('keeps any other error thrown during unload', () => {
    expect(isUnloadSecurityError(new TypeError('x is undefined'), 1000, 1005)).to.eq(false)
    expect(isUnloadSecurityError('SecurityError', 1000, 1005)).to.eq(false)
    expect(isUnloadSecurityError(undefined, 1000, 1005)).to.eq(false)
  })
})
