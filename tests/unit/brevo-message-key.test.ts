import { describe, it, expect } from 'vitest'
import { brevoMessageKey } from '../../server/utils/resend'

// The send API hands back "<id@relay>" and the webhook may send it bare; both
// must land on the same email_messages row or no Brevo event is ever recorded.
describe('brevoMessageKey', () => {
  it('strips the angle brackets the send API wraps the id in', () => {
    expect(brevoMessageKey('<202610261900.123@smtp-relay.mailin.fr>')).toBe('brevo:202610261900.123@smtp-relay.mailin.fr')
  })

  it('gives the same key for the bare id the webhook sends', () => {
    expect(brevoMessageKey('202610261900.123@smtp-relay.mailin.fr')).toBe(brevoMessageKey('<202610261900.123@smtp-relay.mailin.fr>'))
  })

  it('ignores surrounding whitespace', () => {
    expect(brevoMessageKey('  <a@b>  ')).toBe('brevo:a@b')
  })
})
