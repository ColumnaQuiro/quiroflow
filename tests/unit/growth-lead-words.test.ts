import { describe, it, expect } from 'vitest'
import { growthLeadAttributionLabel, growthLeadSource, growthLeadStageTitle, growthLeadTimeInStage } from '../../utils/growthLeadWords'

// The lead board and drawer used to show the API's English to every reader.
const en = (e: string) => e
const es = (_e: string, s: string) => s

describe('growthLeadWords', () => {
  it('names each stage in the reader’s language, and keeps an unknown one as given', () => {
    expect(growthLeadStageTitle('new', en)).toBe('New lead')
    expect(growthLeadStageTitle('new', es)).toBe('Lead nuevo')
    expect(growthLeadStageTitle('lost', es)).toBe('Perdido')
    expect(growthLeadStageTitle('mystery', es, 'Mystery')).toBe('Mystery')
  })

  it('words the time in stage', () => {
    const now = Date.parse('2026-11-07T12:00:00Z')
    expect(growthLeadTimeInStage('2026-11-07T11:59:40Z', es, now)).toBe('Ahora mismo')
    expect(growthLeadTimeInStage('2026-11-07T11:48:00Z', en, now)).toBe('12 min in stage')
    expect(growthLeadTimeInStage('2026-11-07T09:00:00Z', es, now)).toBe('3 h en la etapa')
    expect(growthLeadTimeInStage('2026-11-05T12:00:00Z', en, now)).toBe('2 d in stage')
  })

  it('translates only the "Direct" placeholder source', () => {
    expect(growthLeadSource('Direct', es)).toBe('Directo')
    expect(growthLeadSource('Meta Ads · Back pain', es)).toBe('Meta Ads · Back pain')
  })

  it('labels attribution rows by key, falling back to the server’s label', () => {
    expect(growthLeadAttributionLabel('campaign', es, 'Campaign')).toBe('Campaña')
    expect(growthLeadAttributionLabel(undefined, es, 'Campaign')).toBe('Campaign')
  })
})
