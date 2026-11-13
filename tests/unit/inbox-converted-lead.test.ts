import { describe, it, expect } from 'vitest'
import { foldConvertedLeadMessages, inboxConversationKey, leadsMissingFromList, withConversationOf } from '../../utils/inboxConversationKey'

// The native app caches the messages of every thread it has opened and only
// fetches what is newer afterwards. Converting a lead re-files its messages
// under the patient in the database, but the cached copies kept patient_id
// null, so they stayed keyed lead:<id> and the person showed as two chats --
// the lead's old one and the patient's new one -- until the app was killed.
const leadMessage = { id: 'm1', patient_id: null, phone_number: '17865550100', external_contact_id: null, lead_id: 'lead-1', status: 'read' }

describe('A converted lead in the app Inbox', () => {
  it('re-keys a cached message into the patient thread when its update arrives', () => {
    const moved = withConversationOf(leadMessage, { ...leadMessage, patient_id: 'patient-1' })
    expect(inboxConversationKey(moved, true)).toBe('patient-1')
    // Everything that is not about where it is filed is left alone.
    expect(moved.status).toBe('read')
  })

  it('keeps what an update does not carry', () => {
    const moved = withConversationOf(leadMessage, { patient_id: 'patient-1' })
    expect(moved.phone_number).toBe('17865550100')
    expect(moved.lead_id).toBe('lead-1')
  })

  it('names the held leads the Growth list has stopped listing', () => {
    expect(leadsMissingFromList(['lead-1', 'lead-2', null, 'lead-1'], ['lead-2'])).toEqual(['lead-1'])
    expect(leadsMissingFromList(['lead-2'], ['lead-2'])).toEqual([])
  })

  it("folds a converted lead's cached messages into the patient, and nobody else's", () => {
    const other = { ...leadMessage, id: 'm2', lead_id: 'lead-2' }
    const folded = foldConvertedLeadMessages([leadMessage, other], { 'lead-1': 'patient-1' })
    expect(folded.map((m) => inboxConversationKey(m, true))).toEqual(['patient-1', 'lead:lead-2'])
  })

  it('hands back the same array when there is nothing to fold', () => {
    const list = [leadMessage]
    expect(foldConvertedLeadMessages(list, { 'lead-9': 'patient-9' })).toBe(list)
  })
})
