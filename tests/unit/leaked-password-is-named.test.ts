import { describe, it, expect } from 'vitest'
import { AuthWeakPasswordError, AuthApiError } from '@supabase/supabase-js'
import { passwordRejection } from '../../utils/passwordRejection'

// Telling someone their password is in a breach list, rather than that it is
// "weak and easy to guess".
//
// No browser here -- passwordRejection is a pure function, the same pattern
// billing-rules.test.ts and verifactu-soap.test.ts use. It runs under Vitest
// in `npm run preflight`, so the mapping is checked on every PR.
//
// Built from REAL AuthWeakPasswordError instances rather than hand-written
// lookalikes. The whole point of this function is that it matches auth-js's
// contract instead of its English, so the test has to fail if that contract
// moves under an SDK upgrade -- which a `{ code: 'weak_password' }` literal
// would happily keep passing through.
describe('Why Supabase refused a password', () => {
  const PWNED_MESSAGE = 'Password is known to be weak and easy to guess, please choose a different one.'

  it('recognises a breached password from the reasons, not the message', () => {
    const error = new AuthWeakPasswordError(PWNED_MESSAGE, 422, ['pwned'])

    // The contract this depends on, asserted rather than assumed.
    expect(error.code, 'auth-js still uses this code').to.eq('weak_password')
    expect(error.name).to.eq('AuthWeakPasswordError')

    expect(passwordRejection(error)).to.eq('pwned')
  })

  it('tells a breached password apart from a short one', () => {
    // Both arrive as weak_password and they need opposite advice: adding a
    // character fixes one and does nothing for the other.
    expect(passwordRejection(new AuthWeakPasswordError('too short', 422, ['length']))).to.eq('length')
    expect(passwordRejection(new AuthWeakPasswordError('needs a mix', 422, ['characters']))).to.eq('characters')
  })

  it('leads with the breach when a password is both breached and short', () => {
    const error = new AuthWeakPasswordError(PWNED_MESSAGE, 422, ['length', 'pwned'])
    expect(passwordRejection(error)).to.eq('pwned')
  })

  it('still answers when the reasons array is empty', () => {
    // Supabase sends weak_password with no reasons in some configurations,
    // and `[]` must not fall through to "this was not a password problem".
    expect(passwordRejection(new AuthWeakPasswordError('nope', 422, []))).to.eq('weak')
  })

  it('leaves every other auth error alone', () => {
    // A duplicate email already has a good message and its own route through
    // the signup form; overwriting it with password advice would be worse
    // than the raw string.
    const taken = new AuthApiError('User already registered', 422, 'user_already_exists')
    expect(passwordRejection(taken), 'not a password refusal').to.be.null

    expect(passwordRejection(null)).to.be.null
    expect(passwordRejection(undefined)).to.be.null
    expect(passwordRejection('Failed to fetch')).to.be.null
    expect(passwordRejection({ message: 'Clinic code not found' })).to.be.null
  })
})
