import { describe, expect, it } from 'vitest'
import { pushTokenFailure } from '../../server/utils/pushTokenFailure'

describe('registering a push token when the database refuses it', () => {
  it('answers 403 when the second factor is still owed', () => {
    const failure = pushTokenFailure('new row violates row-level security policy "two factor when required" for table "device_push_tokens"')
    expect(failure.statusCode).to.equal(403)
  })

  it('keeps every other database failure a 500 with its message', () => {
    expect(pushTokenFailure('connection terminated')).to.deep.equal({ statusCode: 500, statusMessage: 'connection terminated' })
    expect(pushTokenFailure('new row violates row-level security policy "users manage own device_push_tokens"').statusCode).to.equal(500)
  })
})
