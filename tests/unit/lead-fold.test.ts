import { describe, it, expect } from 'vitest'
import { FOLD_WINDOW_DAYS, whatsAppLeadToFoldInto, type FoldCandidate } from '../../utils/leadFold'

// An ad form that ends in WhatsApp: the message arrives first and becomes a
// lead, the form arrives minutes later. On 21-23 Nov 2026 the form became a
// second lead with the same number, the drip wrote on one and the
// receptionist on the other. These pin which lead the form is filed onto.

const now = new Date('2026-11-22T00:00:00Z')
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()

const whatsapp = (over: Partial<FoldCandidate> = {}): FoldCandidate => ({
  id: 'wa',
  phone: '34600111222',
  stage: 'contacted',
  patient_id: null,
  external_source: 'whatsapp',
  created_at: minutesAgo(25),
  ...over,
})

describe('Filing an ad form onto the WhatsApp lead it came from', () => {
  it('finds the lead the person started by writing, by number', () => {
    expect(whatsAppLeadToFoldInto([whatsapp()], '34600111222', now)?.id).toBe('wa')
  })

  it('matches the number however it is written', () => {
    expect(whatsAppLeadToFoldInto([whatsapp()], '+34 600 11 12 22', now)?.id).toBe('wa')
  })

  it('files a new lead for a different number', () => {
    expect(whatsAppLeadToFoldInto([whatsapp()], '34600999888', now)).toBeNull()
  })

  it('files a new lead when the form has no number', () => {
    expect(whatsAppLeadToFoldInto([whatsapp()], undefined, now)).toBeNull()
  })

  it('only joins a lead a WhatsApp message started, not another form', () => {
    expect(whatsAppLeadToFoldInto([whatsapp({ external_source: 'facebook' })], '34600111222', now)).toBeNull()
  })

  it('leaves an enquiry that is over alone: converted, a patient, or lost', () => {
    expect(whatsAppLeadToFoldInto([whatsapp({ stage: 'converted' })], '34600111222', now)).toBeNull()
    expect(whatsAppLeadToFoldInto([whatsapp({ patient_id: 'p1' })], '34600111222', now)).toBeNull()
    expect(whatsAppLeadToFoldInto([whatsapp({ stage: 'lost' })], '34600111222', now)).toBeNull()
  })

  it('leaves a conversation older than the window alone', () => {
    const old = whatsapp({ created_at: minutesAgo(FOLD_WINDOW_DAYS * 24 * 60 + 1) })
    expect(whatsAppLeadToFoldInto([old], '34600111222', now)).toBeNull()
  })

  it('takes the newest when there are several', () => {
    const older = whatsapp({ id: 'older', created_at: minutesAgo(3000) })
    const newer = whatsapp({ id: 'newer', created_at: minutesAgo(10) })
    expect(whatsAppLeadToFoldInto([older, newer], '34600111222', now)?.id).toBe('newer')
  })
})
