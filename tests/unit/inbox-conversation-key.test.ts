import { describe, it, expect } from 'vitest'
import { inboxConversationKey, leadIdOfKey } from '../../utils/inboxConversationKey'

// The native app builds its own Inbox threads, and used to key a lead's
// messages by phone even where the web shows them as the lead's own thread --
// so reads did not carry over and a lead's push notification opened nothing.
const fromLead = { patient_id: null, phone_number: '34612345678', external_contact_id: null, lead_id: 'lead-1' }

describe('Which Inbox conversation a message belongs to', () => {
  it("is the lead's own thread for an account with Growth", () => {
    expect(inboxConversationKey(fromLead, true)).toBe('lead:lead-1')
  })

  it('is the number for an account without Growth', () => {
    expect(inboxConversationKey(fromLead, false)).toBe('34612345678')
  })

  it('is the patient once the lead is a patient, Growth or not', () => {
    const converted = { ...fromLead, patient_id: 'patient-1' }
    expect(inboxConversationKey(converted, true)).toBe('patient-1')
    expect(inboxConversationKey(converted, false)).toBe('patient-1')
  })

  it('is the Instagram account when there is no phone', () => {
    expect(inboxConversationKey({ patient_id: null, phone_number: null, external_contact_id: 'igsid-1' }, true)).toBe('igsid-1')
  })

  it('reads the lead back out of a push key', () => {
    expect(leadIdOfKey('lead:lead-1')).toBe('lead-1')
    expect(leadIdOfKey('patient-1')).toBeNull()
    expect(leadIdOfKey('lead:')).toBeNull()
  })
})
