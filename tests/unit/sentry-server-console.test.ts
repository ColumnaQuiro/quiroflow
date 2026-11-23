import { describe, it, expect } from 'vitest'
import {
  createConsoleThrottle,
  isFrameworkRequestErrorLog,
  maskPersonalText,
  serverConsoleError,
  serverConsoleReport,
} from '../../utils/sentryServerConsole'

// utils/sentryServerConsole.ts: a server console.error becomes a Sentry event
// carrying text only, grouped by call site rather than by the ids in it, and
// capped so a loop cannot spend the quota.

const ID = '6f49d0b5-1870-4b53-8c62-946655440000'

describe('maskPersonalText', () => {
  it('masks addresses, phone numbers and query strings', () => {
    expect(maskPersonalText('Invalid `to` field: ana.garcia+citas@example.es')).to.eq('Invalid `to` field: <email>')
    expect(maskPersonalText('Recipient +34 600 123 456 is not on WhatsApp')).to.eq('Recipient <number> is not on WhatsApp')
    expect(maskPersonalText('to 34600123456 failed')).to.eq('to <number> failed')
    expect(maskPersonalText('GET /rest/v1/patients?phone=eq.600123456 failed')).to.eq('GET /rest/v1/patients failed')
  })

  it('keeps ids, dates, statuses and counts', () => {
    expect(maskPersonalText(`account ${ID} answered 503`)).to.eq(`account ${ID} answered 503`)
    expect(maskPersonalText('could not invoice for 2026-11-22 10:00 (3 of 12)')).to.eq('could not invoice for 2026-11-22 10:00 (3 of 12)')
  })
})

describe('serverConsoleReport', () => {
  it('sends only the message and code of an error-shaped object', () => {
    const postgrest = { message: 'duplicate key value violates unique constraint "patients_email_key"', code: '23505', details: 'Key (email)=(ana@example.es) already exists.' }
    const r = serverConsoleReport(['[messenger] could not store a message:', postgrest])
    expect(r.message).to.eq('[messenger] could not store a message: duplicate key value violates unique constraint "patients_email_key" (23505)')
    expect(r.message).not.to.contain('ana@')
  })

  it('drops plain objects and counts arrays instead of printing them', () => {
    const r = serverConsoleReport(['[storage-cleanup] could not remove', ['a/ana-garcia.pdf', 'b.pdf'], { name: 'Ana', phone: '600123456' }])
    expect(r.message).to.eq('[storage-cleanup] could not remove [2 items]')
  })

  it('keeps the Error for its stack, and masks its message', () => {
    const err = new Error('Resend rejected the email: ana@example.es is invalid')
    const r = serverConsoleReport(['[gift-voucher] delivery failed', ID, err])
    expect(r.error).to.eq(err)
    expect(r.message).to.eq(`[gift-voucher] delivery failed ${ID} Error: Resend rejected the email: <email> is invalid`)
    const sent = serverConsoleError(r, new Error())
    expect(sent.name).to.eq('ConsoleError')
    expect(sent.message).to.eq(r.message)
    expect(sent.stack?.split('\n')[0]).to.eq(`ConsoleError: ${r.message}`)
    expect(sent.stack).to.contain('sentry-server-console.test.ts')
    expect(sent.stack).not.to.contain('ana@')
  })

  it('groups one call site as one issue whatever ids it names', () => {
    const a = serverConsoleReport([`[automations] email action failed for patient ${ID}: boom`])
    const b = serverConsoleReport(['[automations] email action failed for patient 0a2c5d1e-0000-4000-8000-000000000001: boom'])
    expect(a.fingerprint).to.deep.eq(b.fingerprint)
    const run1 = serverConsoleReport(['[lead-sequence-cron] run failed:', ID, 'x'])
    const run2 = serverConsoleReport(['[lead-sequence-cron] run failed:', 'another', 'y'])
    expect(run1.fingerprint).to.deep.eq(run2.fingerprint)
    expect(serverConsoleReport(['[gocardless] event failed', 'EV0012AB']).fingerprint).to.deep.eq(serverConsoleReport(['[gocardless] event failed', 'EV00ZZ']).fingerprint)
    expect(serverConsoleReport([`[receptionist-overage] could not claim ${ID} 2026-11:`]).fingerprint)
      .to.deep.eq(serverConsoleReport([`[receptionist-overage] could not claim ${ID} 2026-10:`]).fingerprint)
  })

  it('keeps two call sites apart', () => {
    expect(serverConsoleReport(['[email-budget] could not count a send']).fingerprint)
      .not.to.deep.eq(serverConsoleReport(['[email-budget] could not release a slot']).fingerprint)
  })

  it('caps a long message', () => {
    expect(serverConsoleReport(['x'.repeat(5000)]).message.length).to.be.at.most(1001)
  })
})

describe('isFrameworkRequestErrorLog', () => {
  it("skips Nitro's log of an error the SDK has already sent", () => {
    expect(isFrameworkRequestErrorLog(['[request error] [unhandled] [GET] https://app.quiroflow.com/api/x?q=1\n', new Error('x')])).to.eq(true)
    expect(isFrameworkRequestErrorLog(['[gocardless webhook] event failed'])).to.eq(false)
  })
})

describe('createConsoleThrottle', () => {
  it('lets one through per window and counts the rest', () => {
    const throttle = createConsoleThrottle(1000)
    expect(throttle('a', 0)).to.deep.eq({ send: true, held: 0 })
    expect(throttle('a', 10).send).to.eq(false)
    expect(throttle('a', 20).send).to.eq(false)
    expect(throttle('b', 30).send).to.eq(true)
    expect(throttle('a', 1000)).to.deep.eq({ send: true, held: 2 })
  })

  it('stops tracking new keys when full rather than growing without end', () => {
    const throttle = createConsoleThrottle(1000, 2)
    throttle('a', 0)
    throttle('b', 0)
    expect(throttle('c', 10).send).to.eq(false)
    expect(throttle('c', 2000).send).to.eq(true)
  })
})
