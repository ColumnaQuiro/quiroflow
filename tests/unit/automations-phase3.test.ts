import { describe, expect, it } from 'vitest'
import { isBirthdayOn, localDateString } from '../../utils/birthday'
import { automationEmailHtml, unsubscribeFooterHtml, unsubscribeHeaders } from '../../utils/automationEmail'
import { deriveUnsubscribeKey, signUnsubscribeToken, verifyUnsubscribeToken } from '../../server/utils/unsubscribeToken'

// The pure halves of automations phase 3: the birthday cron's "today" (the
// clinic's, not UTC's), the unsubscribe token, and the envelope a marketing
// email goes out in.

describe('birthday: today is the clinic’s date', () => {
  // 23:30 UTC on 26 Sep 2026 is 01:30 on the 27th in Madrid (CEST, UTC+2).
  const lateUtc = new Date('2026-09-26T23:30:00Z')

  it('reads the date in the clinic’s zone, not UTC', () => {
    expect(localDateString(lateUtc, 'Europe/Madrid')).toBe('2026-09-27')
    expect(localDateString(lateUtc, 'UTC')).toBe('2026-09-26')
    expect(localDateString(lateUtc, 'Atlantic/Canary')).toBe('2026-09-27') // 00:30 WEST
    expect(localDateString(new Date('2026-09-26T22:30:00Z'), 'Atlantic/Canary')).toBe('2026-09-26') // 23:30 WEST
  })

  it('greets a Madrid patient born on the 27th at 23:30 UTC on the 26th, and not one born on the 26th', () => {
    const today = localDateString(lateUtc, 'Europe/Madrid')
    expect(isBirthdayOn('1990-09-27', today)).toBe(true)
    // What the UTC clock used to say was "today".
    expect(isBirthdayOn('1990-09-26', today)).toBe(false)
  })

  it('compares month and day only, and ignores a missing date', () => {
    expect(isBirthdayOn('2001-01-05', '2026-01-05')).toBe(true)
    expect(isBirthdayOn('2001-01-05', '2026-05-01')).toBe(false)
    expect(isBirthdayOn('1992-02-29', '2028-02-29')).toBe(true)
    expect(isBirthdayOn('1992-02-29', '2027-02-28')).toBe(false)
    expect(isBirthdayOn(null, '2026-01-05')).toBe(false)
    expect(isBirthdayOn('', '2026-01-05')).toBe(false)
  })
})

describe('unsubscribe token', () => {
  const key = deriveUnsubscribeKey('server-secret')
  const patient = '3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b'
  const other = '3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7c'

  it('round-trips a patient and a lead', () => {
    expect(verifyUnsubscribeToken(key, signUnsubscribeToken(key, 'patient', patient))).toEqual({ kind: 'patient', id: patient })
    expect(verifyUnsubscribeToken(key, signUnsubscribeToken(key, 'lead', patient))).toEqual({ kind: 'lead', id: patient })
  })

  it('cannot be pointed at another patient', () => {
    const token = signUnsubscribeToken(key, 'patient', patient)
    const edited = token.replace(patient, other)
    expect(edited).not.toBe(token)
    expect(verifyUnsubscribeToken(key, edited)).toBeNull()
  })

  it('cannot turn a patient’s token into a lead’s', () => {
    const token = signUnsubscribeToken(key, 'patient', patient)
    expect(verifyUnsubscribeToken(key, `l${token.slice(1)}`)).toBeNull()
  })

  it('cannot be made without the server’s secret', () => {
    const forged = signUnsubscribeToken(deriveUnsubscribeKey('a guess'), 'patient', patient)
    expect(verifyUnsubscribeToken(key, forged)).toBeNull()
  })

  it('refuses anything malformed', () => {
    for (const bad of ['', 'p', `p.${patient}`, `p.${patient}.`, `x.${patient}.abc`, `p.not-a-uuid.abc`, `p.${patient}.abc.def`, 'a'.repeat(200)]) {
      expect(verifyUnsubscribeToken(key, bad)).toBeNull()
    }
  })

  it('is URL-safe', () => {
    expect(signUnsubscribeToken(key, 'patient', patient)).toMatch(/^[a-z]\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/)
  })
})

describe('marketing email envelope', () => {
  const links = { page: 'https://app.quiroflow.com/unsubscribe/p.x.y', oneClick: 'https://app.quiroflow.com/api/unsubscribe/p.x.y' }

  it('puts an unsubscribe link in the footer of a marketing email', () => {
    const html = automationEmailHtml('<p>Hola</p>', { unsubscribe: links, clinicName: 'Columna Quiro' })
    expect(html).toContain('<p>Hola</p>')
    expect(html).toContain(`href="${links.page}"`)
    expect(html).toContain('Darse de baja')
    expect(html).toContain('Columna Quiro')
  })

  it('leaves a non-marketing email exactly as it was', () => {
    const html = automationEmailHtml('<p>Tu cita</p>')
    expect(html).toContain('<p>Tu cita</p>')
    expect(html).not.toContain('Darse de baja')
    expect(html).not.toContain('unsubscribe')
  })

  it('escapes the clinic name', () => {
    expect(unsubscribeFooterHtml(links.page, '<b>Clínica</b>')).toContain('&lt;b&gt;Clínica&lt;/b&gt;')
  })

  it('sends one-click List-Unsubscribe headers pointing at the endpoint, not the page', () => {
    expect(unsubscribeHeaders(links)).toEqual({
      'List-Unsubscribe': `<${links.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    expect(unsubscribeHeaders(null)).toBeUndefined()
  })
})
