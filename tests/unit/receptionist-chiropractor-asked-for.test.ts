import { describe, expect, it } from 'vitest'
import { CONFIRM_BEFORE_BOOKING, matchChiropractor } from '../../utils/receptionistTypes'
import { BASE_BEHAVIOUR } from '../../utils/receptionistBaseRules'

// A first visit asked for "con Natacha" was offered "con Natacha" and booked
// with Jordana, whoever was free first (20 Nov 2026).
describe('the chiropractor someone asks for by name', () => {
  const natacha = { id: 'n', fullName: 'Natacha Félix' }
  const jordana = { id: 'j', fullName: 'Jordana Pérez' }
  const team = [jordana, natacha]

  it('is found by first name, full name, accents and case aside', () => {
    expect(matchChiropractor(team, 'Natacha')).toBe(natacha)
    expect(matchChiropractor(team, 'natacha felix')).toBe(natacha)
    expect(matchChiropractor(team, 'NATACHA FÉLIX')).toBe(natacha)
    expect(matchChiropractor(team, 'Félix')).toBe(natacha)
  })

  it('is nobody when a word is not in the name, and ambiguous when two fit', () => {
    expect(matchChiropractor(team, 'Natacha Gómez')).toBeNull()
    expect(matchChiropractor(team, 'Léa')).toBeNull()
    expect(matchChiropractor(team, '')).toBeNull()
    expect(matchChiropractor([natacha, { id: 'n2', fullName: 'Natacha Ruiz' }], 'Natacha')).toBe('ambiguous')
  })

  it('is said to the model: her times only, and ask before anyone else', () => {
    const line = BASE_BEHAVIOUR.find((l) => l.includes('one chiropractor by name'))
    expect(line).toBeTruthy()
    expect(line).toMatch(/find_free_times and chiropractor/)
    expect(line).toMatch(/ask whether another chiropractor would do/)
  })
})

describe('a time they ask for in their own words (19 Nov 2026)', () => {
  it('is booked when free, without "¿te lo confirmo?"', () => {
    expect(BASE_BEHAVIOUR.some((l) => /sobre las 15h/.test(l) && /without asking them to confirm/.test(l))).toBe(true)
    expect(CONFIRM_BEFORE_BOOKING).toMatch(/named by them too/)
    // Only a day alone, or a time alone, still needs asking.
    expect(CONFIRM_BEFORE_BOOKING).toMatch(/a day without a time, or a time without a day/)
  })
})

describe('bad news (19 Nov 2026)', () => {
  it('opens with a sentence of sympathy', () => {
    expect(BASE_BEHAVIOUR.some((l) => /fallecido/.test(l) && /Siento mucho tu pérdida/.test(l))).toBe(true)
  })
})
