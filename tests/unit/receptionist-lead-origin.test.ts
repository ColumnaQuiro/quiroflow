import { describe, it, expect } from 'vitest'
import { cameFromAd, leadOriginSection, type LeadOrigin } from '../../utils/receptionistLeadOrigin'

// A clinic can price a first visit differently for someone who came from its
// ad, and the receptionist used to find that out by asking "how did you hear
// about us?" -- of people who had just filled in that ad's form. These pin
// that the lead record answers it instead, and that the campaign's internal
// name never reaches the prompt.

const blank: LeadOrigin = { channel: null, source: null, externalSource: null, campaign: null, ad: null }

describe('Whether a lead came from an ad', () => {
  it('reads a Meta lead-ad form as an ad', () => {
    expect(cameFromAd({ ...blank, channel: 'facebook', externalSource: 'facebook' })).toBe(true)
  })

  it('reads an attributed campaign as an ad, whatever the channel', () => {
    expect(cameFromAd({ ...blank, channel: 'whatsapp', campaign: 'Otoño' })).toBe(true)
  })

  it('reads a "Meta Ads" source as an ad', () => {
    expect(cameFromAd({ ...blank, channel: 'web', source: 'Meta Ads · 27/01/24 - Open' })).toBe(true)
  })

  it('does not assume a WhatsApp or Instagram message came from an ad', () => {
    expect(cameFromAd({ ...blank, channel: 'whatsapp', source: 'WhatsApp', externalSource: 'whatsapp' })).toBe(false)
    expect(cameFromAd({ ...blank, channel: 'instagram', source: 'Instagram' })).toBe(false)
  })
})

describe('What the prompt is told', () => {
  it('tells it never to ask an ad lead how they heard about the clinic', () => {
    const section = leadOriginSection({ ...blank, channel: 'facebook', campaign: '27/01/24 - Open - Valencia +8Km' })
    expect(section).toContain('never ask')
    expect(section).not.toContain('27/01/24')
  })

  it('leaves it to ask when the source is unknown', () => {
    const section = leadOriginSection({ ...blank, channel: 'whatsapp' })
    expect(section).toContain('on WhatsApp')
    expect(section).toContain('ask')
    expect(section).not.toContain('never ask')
  })

  it('says nothing when nothing is known', () => {
    expect(leadOriginSection(blank)).toBe('')
  })
})
