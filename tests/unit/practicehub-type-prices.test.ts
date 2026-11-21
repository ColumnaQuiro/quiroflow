import { describe, it, expect } from 'vitest'
import { practiceHubPriceToWrite, practiceHubServiceCents, practiceHubTypePrice, practiceHubUnpricedTypesWarning, type PracticeHubBillableItem } from '../../utils/practicehubTypePrices'

// The appointment-types import step prices each type from PracticeHub's
// services (2.0's /billable_items), since PracticeHub keeps no price on the
// type itself. These services are the shapes a live account returned on
// 18 Nov 2026, where each type's "Default Services" was read from
// PracticeHub's settings screen to check the matching against.
const services: PracticeHubBillableItem[] = [
  { id: 1, description: 'Ajuste Quiropractico', amount: '55.00', active: null },
  { id: 2, description: 'Primera Visita', amount: '70.00', active: null },
  { id: 3, description: 'Informe Quiropractico', amount: '60.00', active: null },
  { id: 6, description: 'Revisión', amount: '60.00', active: null },
  { id: 7, description: 'Oferta de Primera Visita ', amount: '50.00', active: null },
  { id: 9, description: 'Chequeo Postural ', amount: '0.00', active: null },
  { id: 10, description: 'Informe Quiropractico', amount: '60.00', active: true },
  { id: 11, description: 'Reactivación paciente', amount: '60.00', active: true },
]

describe('PracticeHub price for an appointment type', () => {
  it('takes the amount of the service with the same name', () => {
    expect(practiceHubTypePrice('Ajuste Quiropractico', services)).toEqual({ billableItemId: 1, serviceName: 'Ajuste Quiropractico', priceCents: 5500 })
    expect(practiceHubTypePrice('Reactivación paciente', services)?.priceCents).toBe(6000)
  })

  it('ignores case, accents and stray spaces in either name', () => {
    expect(practiceHubTypePrice('Primera visita', services)?.priceCents).toBe(7000)
    expect(practiceHubTypePrice('Informe Quiropráctico', services)?.priceCents).toBe(6000)
    expect(practiceHubTypePrice('  ajuste   quiropractico ', services)?.priceCents).toBe(5500)
  })

  it('has no price for a type whose name no service shares, rather than a guess', () => {
    // On the live account these types' default services are "Revisión" and
    // "Oferta de Primera Visita", a link no API returns.
    expect(practiceHubTypePrice('Revisión 2', services)).toBeNull()
    expect(practiceHubTypePrice('Oferta Primera visita', services)).toBeNull()
    expect(practiceHubTypePrice('Mantenimiento Quiropractico', services)).toBeNull()
  })

  it('accepts two same-named services at one price, and refuses them at two', () => {
    expect(practiceHubTypePrice('Informe Quiropractico', services)?.priceCents).toBe(6000)
    const disagreeing = [...services, { id: 12, description: 'Ajuste Quiropractico', amount: '45.00', active: true }]
    expect(practiceHubTypePrice('Ajuste Quiropractico', disagreeing)).toBeNull()
  })

  it('prefers the live service when a retired one of the same name has an old price', () => {
    const withRetired = [...services, { id: 13, description: 'Ajuste Quiropractico', amount: '40.00', active: false }]
    expect(practiceHubTypePrice('Ajuste Quiropractico', withRetired)?.priceCents).toBe(5500)
  })

  it('never takes a retired service’s price, even when it is the only one of that name', () => {
    // QuiroBalance, 20 Nov 2026: "Ajuste" is charged with another, live
    // service at 50.00; the retired "Ajuste " at 30.00 is an old price.
    const quiroBalance: PracticeHubBillableItem[] = [
      { id: 1, description: 'Chequeo quiropráctico y ajuste 2025', amount: '50.00', active: null },
      { id: 11, description: 'Ajuste ', amount: '30.00', active: false },
    ]
    expect(practiceHubTypePrice('Ajuste', quiroBalance)).toBeNull()
  })

  it('reads amounts as cents and refuses discounts and nonsense', () => {
    expect(practiceHubServiceCents('55.00')).toBe(5500)
    expect(practiceHubServiceCents('49.9')).toBe(4990)
    expect(practiceHubServiceCents('0.00')).toBe(0)
    expect(practiceHubServiceCents('-10.00')).toBeNull()
    expect(practiceHubServiceCents('')).toBeNull()
    expect(practiceHubServiceCents(null)).toBeNull()
  })
})

describe('Writing PracticeHub’s price to a type', () => {
  it('gives a type being created PracticeHub’s price', () => {
    expect(practiceHubPriceToWrite(null, 5500)).toBe(5500)
  })

  it('fills in a type here still at 0, which is what every earlier import left', () => {
    expect(practiceHubPriceToWrite(0, 5500)).toBe(5500)
  })

  it('never overwrites a price the clinic has set in QuiroFlow', () => {
    // A type a clinic priced at 100 € by hand stays at 100 €, whatever
    // PracticeHub says.
    expect(practiceHubPriceToWrite(10000, 9900)).toBeNull()
    expect(practiceHubPriceToWrite(6000, 6000)).toBeNull()
    expect(practiceHubPriceToWrite(1, 5500)).toBeNull()
  })

  it('writes nothing when PracticeHub has no price, or a price of 0', () => {
    expect(practiceHubPriceToWrite(0, null)).toBeNull()
    expect(practiceHubPriceToWrite(null, undefined)).toBeNull()
    expect(practiceHubPriceToWrite(0, 0)).toBeNull()
    expect(practiceHubPriceToWrite(null, 0)).toBeNull()
  })
})

describe('Naming the types left without a price', () => {
  const en = (english: string) => english
  it('lists each name once, trimmed', () => {
    expect(practiceHubUnpricedTypesWarning(['Informe', 'Ajuste 30 ', 'Informe'], en)).toMatch(/^No price in PracticeHub for: Informe, Ajuste 30\. /)
  })

  it('says nothing when every type has a price', () => {
    expect(practiceHubUnpricedTypesWarning([], en)).toBeNull()
    expect(practiceHubUnpricedTypesWarning(['  '], en)).toBeNull()
  })
})
