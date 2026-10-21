import { describe, expect, it } from 'vitest'
import { isPatientReferralSource, leadSourceChannel } from '../../utils/referralSource'

// The patient record asks "referred by which patient?" for these sources
// only. It used to be the exact text "Patient", so a clinic using
// "Referral" -- or a Spanish name -- could never say who sent someone.
describe('isPatientReferralSource', () => {
  it('accepts the seeded source and the other names for a referral', () => {
    for (const name of ['Patient', 'Referral', 'Paciente', 'Referido', 'Referida', 'Recomendación', 'recomendacion', 'Boca a boca', 'Word of mouth'])
      expect(isPatientReferralSource(name), name).toBe(true)
  })

  it('ignores case, accents and surrounding space', () => {
    expect(isPatientReferralSource('  REFERRAL ')).toBe(true)
    expect(isPatientReferralSource('Recomendación de paciente')).toBe(true)
  })

  it('leaves the other channels alone', () => {
    for (const name of ['Instagram', 'Facebook', 'Google', 'Website', 'Organic', 'Other', '', null, undefined])
      expect(isPatientReferralSource(name), String(name)).toBe(false)
  })
})

// What a patient's origin is set to from their lead: the channel, never the
// campaign, so the origin report is one row per channel.
describe('leadSourceChannel', () => {
  it('keeps the channel and drops the campaign', () => {
    expect(leadSourceChannel('Meta Ads · 27/01/24 - Open - Valencia +8Km')).toBe('Meta Ads')
    expect(leadSourceChannel('Google Ads · cq06-demand-gen')).toBe('Google Ads')
  })

  it('passes a plain source through', () => {
    expect(leadSourceChannel('Google Ads')).toBe('Google Ads')
    expect(leadSourceChannel(' WhatsApp ')).toBe('WhatsApp')
  })

  it('is null when there is nothing to say', () => {
    for (const source of ['', '   ', ' · campaign', null, undefined]) expect(leadSourceChannel(source), String(source)).toBeNull()
  })
})
