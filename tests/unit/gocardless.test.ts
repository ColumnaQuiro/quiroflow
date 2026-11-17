import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { suggestMandatePatient, mandateNameKey, mergedCustomerMetadata, GOCARDLESS_PATIENT_METADATA_KEY, type MatchablePatient } from '../../utils/gocardlessMatch'
import { gocardlessSignatureValid, gocardlessInterval } from '../../server/utils/gocardless'

const patients: MatchablePatient[] = [
  { id: 'ana', first_name: 'Ana', last_name: 'García Pérez', email: 'ana@example.com', phone_search: '612345678' },
  { id: 'luis', first_name: 'Luis', last_name: 'Martín', email: 'familia@example.com', phone_search: '699000111 911222333' },
  { id: 'sofia', first_name: 'Sofía', last_name: 'Martín', email: 'familia@example.com', phone_search: null },
  { id: 'pablo', first_name: 'Pablo', last_name: 'Ruiz', email: null, phone_search: '600111222' },
  { id: 'pablo2', first_name: 'Pablo', last_name: 'Ruiz', email: null, phone_search: null },
]
const customer = (c: Partial<Parameters<typeof suggestMandatePatient>[0]>) => ({ email: null, given_name: null, family_name: null, company_name: null, phone_number: null, ...c })

describe('suggestMandatePatient', () => {
  it('matches on email, ignoring case and spaces', () => {
    expect(suggestMandatePatient(customer({ email: ' ANA@example.com ' }), patients)).toEqual({ patientId: 'ana', by: 'email' })
  })

  it('does not pick one of two patients who share an email; falls through to the name', () => {
    expect(suggestMandatePatient(customer({ email: 'familia@example.com', given_name: 'Sofía', family_name: 'Martín' }), patients)).toEqual({ patientId: 'sofia', by: 'name' })
  })

  it('says it is ambiguous when nothing narrows it to one', () => {
    expect(suggestMandatePatient(customer({ email: 'familia@example.com' }), patients)).toEqual({ patientId: null, by: null, ambiguous: true })
  })

  it('matches a phone written with the country prefix against any of the patient’s numbers', () => {
    expect(suggestMandatePatient(customer({ phone_number: '+34 911 222 333' }), patients)).toEqual({ patientId: 'luis', by: 'phone' })
  })

  it('matches a name without accents or with different spacing', () => {
    expect(suggestMandatePatient(customer({ given_name: 'ana', family_name: 'Garcia  Perez' }), patients)).toEqual({ patientId: 'ana', by: 'name' })
  })

  it('refuses two patients with the same name', () => {
    expect(suggestMandatePatient(customer({ given_name: 'Pablo', family_name: 'Ruiz' }), patients)).toEqual({ patientId: null, by: null, ambiguous: true })
  })

  it('finds nobody for a stranger', () => {
    expect(suggestMandatePatient(customer({ email: 'x@y.z', given_name: 'Nadie' }), patients)).toEqual({ patientId: null, by: null, ambiguous: false })
  })

  it('normalises names', () => {
    expect(mandateNameKey('  José  García-Pérez ')).toBe('jose garcia perez')
  })
})

describe('gocardlessSignatureValid', () => {
  const secret = 'whsec-test'
  const body = JSON.stringify({ events: [{ id: 'EV1' }] })
  const signed = createHmac('sha256', secret).update(body).digest('hex')

  it('accepts the HMAC-SHA256 of the raw body', () => {
    expect(gocardlessSignatureValid(body, signed, secret)).toBe(true)
  })
  it('refuses a body that was changed', () => {
    expect(gocardlessSignatureValid(body.replace('EV1', 'EV2'), signed, secret)).toBe(false)
  })
  it('refuses a missing signature or secret', () => {
    expect(gocardlessSignatureValid(body, undefined, secret)).toBe(false)
    expect(gocardlessSignatureValid(body, signed, '')).toBe(false)
  })
})

describe('gocardlessInterval', () => {
  it('maps a plan period to GoCardless’s vocabulary', () => {
    expect(gocardlessInterval('month', 1)).toEqual({ interval_unit: 'monthly', interval: 1 })
    expect(gocardlessInterval('week', 2)).toEqual({ interval_unit: 'weekly', interval: 2 })
    expect(gocardlessInterval('year', null)).toEqual({ interval_unit: 'yearly', interval: 1 })
  })
})

describe('suggestMandatePatient: our id and similar names', () => {
  it('trusts our own patient id on the customer before anything else', () => {
    expect(suggestMandatePatient(customer({ email: 'ana@example.com', metadata: { quiroflow_patient_id: 'luis' } }), patients)).toEqual({ patientId: 'luis', by: 'metadata' })
  })

  it('ignores an id that is not one of this clinic’s patients', () => {
    expect(suggestMandatePatient(customer({ email: 'ana@example.com', metadata: { quiroflow_patient_id: 'elsewhere' } }), patients)).toEqual({ patientId: 'ana', by: 'email' })
  })

  it('suggests a name written with an initial, marked as loose', () => {
    expect(suggestMandatePatient(customer({ given_name: 'A.', family_name: 'García' }), patients)).toEqual({ patientId: 'ana', by: 'name', loose: true })
  })

  it('suggests one surname where the patient has two', () => {
    expect(suggestMandatePatient(customer({ given_name: 'Ana', family_name: 'Garcia' }), patients)).toEqual({ patientId: 'ana', by: 'name', loose: true })
  })

  it('does not loosen a name two patients share', () => {
    expect(suggestMandatePatient(customer({ given_name: 'P.', family_name: 'Ruiz' }), patients)).toEqual({ patientId: null, by: null, ambiguous: true })
  })

  it('does not suggest a different first name with the same surname', () => {
    expect(suggestMandatePatient(customer({ given_name: 'Marta', family_name: 'García' }), patients)).toEqual({ patientId: null, by: null, ambiguous: false })
  })
})

describe('mergedCustomerMetadata', () => {
  it('adds our key beside another app’s', () => {
    expect(mergedCustomerMetadata({ practicehub: 'x' }, 'p1')).toEqual({ practicehub: 'x', [GOCARDLESS_PATIENT_METADATA_KEY]: 'p1' })
  })
  it('writes nothing when it already names the patient', () => {
    expect(mergedCustomerMetadata({ [GOCARDLESS_PATIENT_METADATA_KEY]: 'p1' }, 'p1')).toBeNull()
  })
  it('writes nothing when other apps hold all three keys', () => {
    expect(mergedCustomerMetadata({ a: '1', b: '2', c: '3' }, 'p1')).toBeNull()
  })
  it('replaces our own key even when the object is full', () => {
    expect(mergedCustomerMetadata({ a: '1', b: '2', [GOCARDLESS_PATIENT_METADATA_KEY]: 'old' }, 'p1')).toEqual({ a: '1', b: '2', [GOCARDLESS_PATIENT_METADATA_KEY]: 'p1' })
  })
  it('removes only our key', () => {
    expect(mergedCustomerMetadata({ a: '1', [GOCARDLESS_PATIENT_METADATA_KEY]: 'p1' }, null)).toEqual({ a: '1' })
  })
  it('writes nothing to remove a key that is not there', () => {
    expect(mergedCustomerMetadata({ a: '1' }, null)).toBeNull()
  })
})
