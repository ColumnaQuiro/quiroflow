import { describe, it, expect } from 'vitest'
import { centsToInput, moveItem, orderTypes, parseEurosToCents, typeProblems, type TypeRules } from '../../utils/appointmentTypes'

// The old Appointment Types table saved whatever was typed: a duration of 0,
// a price of "abc" (parseFloat -> NaN -> 0 € without a word), a deposit above
// the price that Stripe was then asked to charge, and two types both called
// "Ajuste". The same rules are constraints in the database now; these pin the
// page's own reading of them, so it names the field before the save does.

const base: TypeRules = { id: 't1', name: 'Ajuste', duration: '30', price: '40,00', paymentRequired: false, deposit: '', maxDaysAhead: '' }

describe('Reading a price the way it is typed in Spain', () => {
  it('takes a comma as the decimal separator', () => {
    expect(parseEurosToCents('60,00')).toBe(6000)
    expect(parseEurosToCents('60,5')).toBe(6050)
    expect(parseEurosToCents('1.234,50')).toBe(123450)
  })

  it('takes a lone point followed by cents, which is what a paste usually is', () => {
    expect(parseEurosToCents('60.00')).toBe(6000)
    expect(parseEurosToCents('60.5')).toBe(6050)
  })

  it('reads a bare point with three digits as thousands', () => {
    expect(parseEurosToCents('1.234')).toBe(123400)
  })

  it('ignores the euro sign and spaces', () => {
    expect(parseEurosToCents(' 45 € ')).toBe(4500)
  })

  it('tells empty apart from nonsense', () => {
    expect(parseEurosToCents('')).toBeNull()
    expect(parseEurosToCents('abc')).toBeNaN()
    expect(parseEurosToCents('12,345')).toBeNaN()
  })

  it('writes cents back the same way', () => {
    expect(centsToInput(6000)).toBe('60,00')
    expect(centsToInput(123450)).toBe('1234,50')
    expect(centsToInput(null)).toBe('')
  })
})

describe('What stops a type being saved', () => {
  it('passes a plain valid type', () => {
    expect(typeProblems(base, [])).toEqual({})
  })

  it('refuses a second active type with the same name, whatever its case or spacing', () => {
    expect(typeProblems({ ...base, name: '  ajuste ' }, [{ id: 't2', name: 'Ajuste' }]).name).toBe('name_taken')
  })

  it('does not count the type against itself', () => {
    expect(typeProblems(base, [{ id: 't1', name: 'Ajuste' }]).name).toBeUndefined()
  })

  it('needs a name', () => {
    expect(typeProblems({ ...base, name: '   ' }, []).name).toBe('name_missing')
  })

  it('holds the duration to 5-480 whole minutes', () => {
    expect(typeProblems({ ...base, duration: '5' }, []).duration).toBeUndefined()
    expect(typeProblems({ ...base, duration: '480' }, []).duration).toBeUndefined()
    expect(typeProblems({ ...base, duration: '4' }, []).duration).toBe('duration_invalid')
    expect(typeProblems({ ...base, duration: '481' }, []).duration).toBe('duration_invalid')
    expect(typeProblems({ ...base, duration: '' }, []).duration).toBe('duration_invalid')
    expect(typeProblems({ ...base, duration: '30.5' }, []).duration).toBe('duration_invalid')
  })

  it('reads a duration a number field has already turned into a number', () => {
    expect(typeProblems({ ...base, duration: 45, maxDaysAhead: 30 }, []).duration).toBeUndefined()
    expect(typeProblems({ ...base, duration: 4 }, []).duration).toBe('duration_invalid')
  })

  it('takes an empty price as free, but not a negative or unreadable one', () => {
    expect(typeProblems({ ...base, price: '' }, []).price).toBeUndefined()
    expect(typeProblems({ ...base, price: '-5' }, []).price).toBe('price_invalid')
    expect(typeProblems({ ...base, price: 'gratis' }, []).price).toBe('price_invalid')
  })

  it('refuses a deposit above the price, which the card would otherwise be charged', () => {
    const paying = { ...base, price: '60,00', paymentRequired: true }
    expect(typeProblems({ ...paying, deposit: '80,00' }, []).deposit).toBe('deposit_over_price')
    expect(typeProblems({ ...paying, deposit: '60,00' }, []).deposit).toBeUndefined()
    expect(typeProblems({ ...paying, deposit: '' }, []).deposit).toBeUndefined()
  })

  it('ignores a leftover deposit when payment at booking is off', () => {
    expect(typeProblems({ ...base, deposit: '999' }, []).deposit).toBeUndefined()
  })

  it('leaves the booking window empty for the clinic default, but refuses zero', () => {
    expect(typeProblems({ ...base, maxDaysAhead: '' }, []).maxDays).toBeUndefined()
    expect(typeProblems({ ...base, maxDaysAhead: '0' }, []).maxDays).toBe('max_days_invalid')
  })
})

describe('The order types are offered in', () => {
  it("follows the clinic's order, then the name", () => {
    const out = orderTypes([
      { name: 'Alta', sort_order: 3 },
      { name: 'Ajuste', sort_order: 1 },
      { name: 'Revisión', sort_order: 2 },
    ])
    expect(out.map((t) => t.name)).toEqual(['Ajuste', 'Revisión', 'Alta'])
  })

  it('puts a type with no position yet at the end rather than the front', () => {
    const out = orderTypes([
      { name: 'Nuevo', sort_order: null },
      { name: 'Ajuste', sort_order: 1 },
    ])
    expect(out.map((t) => t.name)).toEqual(['Ajuste', 'Nuevo'])
  })

  it('moves one item without disturbing the rest', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})
