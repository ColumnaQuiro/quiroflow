import { describe, expect, it } from 'vitest'
import { patientActionRecipients } from '../../server/utils/patientActionRecipients'

const owner = { id: 'owner', is_owner: true }
const coOwner = { id: 'co-owner', is_owner: true }
const physio = { id: 'physio', is_owner: false }
const other = { id: 'other', is_owner: false }

describe('who hears that a patient paid online or joined the waitlist', () => {
  it("is the patient's practitioner and the owners, not the rest of the team", () => {
    expect(patientActionRecipients([owner, coOwner, physio, other], 'physio').map((m) => m.id)).toEqual(['owner', 'co-owner', 'physio'])
  })
  it('is only the owners when the patient has no practitioner', () => {
    expect(patientActionRecipients([owner, physio], null).map((m) => m.id)).toEqual(['owner'])
  })
  it('tells an owner who is also the practitioner once', () => {
    expect(patientActionRecipients([owner, owner], 'owner').map((m) => m.id)).toEqual(['owner'])
  })
})
