import { describe, it, expect } from 'vitest'
import { bonoPaymentDescription } from '../../utils/billingDescriptions'

// The bono line on a factura is stored and sent to the AEAT, so it is Spanish
// with Spanish amounts whatever language the screen is in.
describe('bonoPaymentDescription', () => {
  it('describes the whole bono in Spanish, with Spanish amounts', () => {
    expect(bonoPaymentDescription('Bono 10 sesiones', 38000, 38000, 10)).toBe(
      'Bono 10 sesiones — 380,00 € de 380,00 € (10 de 10 sesiones)',
    )
  })

  it('rounds a part payment down to the sessions it has bought', () => {
    expect(bonoPaymentDescription('Bono 12', 26400, 52800, 12)).toBe('Bono 12 — 264,00 € de 528,00 € (6 de 12 sesiones)')
    expect(bonoPaymentDescription('Bono 12', 10000, 52800, 12)).toContain('(2 de 12 sesiones)')
  })

  it('names the plazo a payment is, when it is one', () => {
    expect(bonoPaymentDescription('Bono 10 sesiones', 25000, 50000, 10, { number: 2, of: 2 })).toBe(
      'Bono 10 sesiones — plazo 2 de 2: 250,00 € de 500,00 € (5 de 10 sesiones)',
    )
  })

  it('says sesión for a one-session bono', () => {
    expect(bonoPaymentDescription('Bono prueba', 4000, 4000, 1)).toContain('(1 de 1 sesión)')
  })
})
