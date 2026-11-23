import { describe, expect, it } from 'vitest'
import { isUnregisteredPushToken, pushTokenFailure } from '../../server/utils/pushTokenFailure'

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

describe('recognising a push token FCM has unregistered', () => {
  it('is unregistered when the app was uninstalled (FCM 404 UNREGISTERED)', () => {
    expect(isUnregisteredPushToken({ error: { code: 404, message: 'Device unregistered.', status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })).to.equal(true)
  })

  it('is unregistered when APNs disabled the token (410)', () => {
    expect(isUnregisteredPushToken({ error: { code: 404, message: 'APNs device token is disabled.', status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }, { statusCode: 410, reason: 'Unregistered' }] } })).to.equal(true)
  })

  it('keeps the token on any other failure', () => {
    expect(isUnregisteredPushToken({ error: { code: 503, status: 'UNAVAILABLE', details: [{ errorCode: 'UNAVAILABLE' }] } })).to.equal(false)
    expect(isUnregisteredPushToken({ error: { code: 401, status: 'UNAUTHENTICATED' } })).to.equal(false)
    expect(isUnregisteredPushToken('fetch failed')).to.equal(false)
    expect(isUnregisteredPushToken(null)).to.equal(false)
  })
})
