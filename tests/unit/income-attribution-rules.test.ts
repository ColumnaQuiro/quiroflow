import { describe, it, expect } from 'vitest'
import { classifyPaymentForFilter, practitionerForPayment } from '../../utils/incomeAttribution'

// Whose income a payment is, pinned without a browser.
//
// Two screens answer this question -- the Income report's practitioner
// breakdown and Income performance's series -- and a third filters by it.
// They had three implementations, and the breakdown's was the one that never
// got the patient fallback: 13,164 EUR of September 2026's 16,711 read as
// "Sin asignar" there while the filter counted the same euros to a
// practitioner. These tests exist so the three cannot drift apart again.
const beatriz = 'beatriz-id'
const jordana = 'jordana-id'

describe('Whose income a payment is', () => {
  describe('the practitioner it belongs to', () => {
    it('is the one who saw the patient, when there was a visit', () => {
      expect(
        practitionerForPayment({
          appointment: { practitioner_id: beatriz, clinic_id: 'c1' },
          patient: { default_practitioner_id: jordana, clinic_id: 'c1' },
        }),
        'the visit wins over the patient default',
      ).toBe(beatriz)
    })

    it("is the patient's own, for money with no visit behind it", () => {
      // A bono, money on account, a quick invoice. None of these has an
      // appointment by design, and all of them used to belong to nobody.
      expect(
        practitionerForPayment({
          appointment: null,
          patient: { default_practitioner_id: jordana, clinic_id: 'c1' },
        }),
      ).toBe(jordana)
    })

    it('is nobody when an appointment exists but names no practitioner', () => {
      // Falling through to the patient here would be a different answer from
      // the filter's, which treats a visit as the end of the chain.
      expect(
        practitionerForPayment({
          appointment: { practitioner_id: null, clinic_id: 'c1' },
          patient: { default_practitioner_id: jordana, clinic_id: 'c1' },
        }),
      ).toBe(null)
    })

    it('is nobody, rather than a guess, when nothing says whose it is', () => {
      expect(practitionerForPayment({ appointment: null, patient: { default_practitioner_id: null, clinic_id: 'c1' } })).toBe(null)
      expect(practitionerForPayment({ appointment: null, patient: null })).toBe(null)
    })
  })

  describe('agrees with the filter', () => {
    // The filter and the breakdown read the same payments on the same screen.
    // If one counts a bono to Jordana, the other must not call it unassigned.
    const bonoOfJordanasPatient = {
      appointment: null,
      patient: { default_practitioner_id: jordana, clinic_id: 'c1' },
    }

    it('counts a bono to the patient’s practitioner in both', () => {
      expect(classifyPaymentForFilter({ ...bonoOfJordanasPatient, practitionerId: jordana })).toBe('matches')
      expect(practitionerForPayment(bonoOfJordanasPatient)).toBe(jordana)
    })

    it('keeps it out of another practitioner’s filter, and out of their bucket', () => {
      expect(classifyPaymentForFilter({ ...bonoOfJordanasPatient, practitionerId: beatriz })).toBe('excluded')
      expect(practitionerForPayment(bonoOfJordanasPatient)).not.toBe(beatriz)
    })

    it('reports the genuinely unplaceable as unplaceable in both', () => {
      const orphan = { appointment: null, patient: { default_practitioner_id: null, clinic_id: null } }
      expect(classifyPaymentForFilter({ ...orphan, practitionerId: beatriz })).toBe('unattributable')
      expect(practitionerForPayment(orphan)).toBe(null)
    })
  })
})
