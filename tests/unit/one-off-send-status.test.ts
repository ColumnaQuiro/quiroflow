import { describe, expect, it } from 'vitest'
import { ONE_OFF_SEND_TONE, oneOffSendLabel, oneOffSendStatus } from '../../utils/oneOffSendStatus'

// Where a one-off send stands, as the Sends list and the send's checklist
// show it: Draft, Scheduled, Sending, Paused or Sent.

const now = new Date('2026-11-24T10:00:00Z')
const later = '2026-12-03T09:00:00.000Z' // 10:00 in Madrid
const earlier = '2026-11-24T09:00:00.000Z'
const once = (starts_at?: string) => ({ schedule: { kind: 'once', ...(starts_at ? { starts_at } : {}) } })
const t = (_en: string, es: string) => es

describe('oneOffSendStatus', () => {
  it('is a draft until it is switched on, dated or not', () => {
    expect(oneOffSendStatus({ enabled: false, segment: once() }, { running: 0 }, now)).toEqual({ state: 'draft', at: null })
    expect(oneOffSendStatus({ enabled: false, segment: once(later) }, { running: 0 }, now)).toEqual({ state: 'draft', at: later })
  })

  it('is scheduled when switched on with a date still to come', () => {
    expect(oneOffSendStatus({ enabled: true, segment: once(later), segment_last_run_at: null }, { running: 0 }, now)).toEqual({ state: 'scheduled', at: later })
  })

  it('is sending once due: switched on with no date, or a date that has come, and not yet claimed', () => {
    expect(oneOffSendStatus({ enabled: true, segment: once() }, { running: 0 }, now).state).toBe('sending')
    expect(oneOffSendStatus({ enabled: true, segment: once(earlier) }, { running: 0 }, now).state).toBe('sending')
  })

  it('is sending while people are still on their way through it, or a daily cap carries on', () => {
    const wentOut = { enabled: true, segment: once(earlier), segment_last_run_at: earlier }
    expect(oneOffSendStatus(wentOut, { running: 12 }, now).state).toBe('sending')
    expect(oneOffSendStatus(wentOut, { running: 0, carryingOver: true }, now).state).toBe('sending')
  })

  it('is paused when switched off with people still inside', () => {
    expect(oneOffSendStatus({ enabled: false, segment: once(), segment_last_run_at: earlier }, { running: 3 }, now)).toEqual({ state: 'paused', at: null })
  })

  it('is sent, at the moment it was claimed, once nobody is left inside', () => {
    expect(oneOffSendStatus({ enabled: true, segment: once(earlier), segment_last_run_at: earlier }, { running: 0 }, now)).toEqual({ state: 'sent', at: earlier })
    // Switched off afterwards it is still sent, not a draft: it went.
    expect(oneOffSendStatus({ enabled: false, segment: once(), segment_last_run_at: earlier }, { running: 0 }, now).state).toBe('sent')
  })

  it('stays sent whatever date it is moved to: a claimed send never goes again', () => {
    expect(oneOffSendStatus({ enabled: true, segment: once(later), segment_last_run_at: earlier }, { running: 0 }, now)).toEqual({ state: 'sent', at: earlier })
  })
})

describe('oneOffSendLabel', () => {
  it('says the date on the clinic clock', () => {
    expect(oneOffSendLabel({ state: 'scheduled', at: later }, t, 'Europe/Madrid')).toBe('Programada · 3 dic, 10:00')
    expect(oneOffSendLabel({ state: 'sent', at: later }, t, 'Atlantic/Canary')).toBe('Enviada · 3 dic, 09:00')
    expect(oneOffSendLabel({ state: 'sending', at: null }, t)).toBe('Enviando')
    expect(oneOffSendLabel({ state: 'draft', at: later }, t)).toBe('Borrador')
  })

  it('has a tone for every state', () => {
    for (const state of ['draft', 'scheduled', 'sending', 'paused', 'sent'] as const) expect(ONE_OFF_SEND_TONE[state]).toBeTruthy()
  })
})
