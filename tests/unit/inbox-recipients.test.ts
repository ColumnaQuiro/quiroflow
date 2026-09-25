import { describe, it, expect } from 'vitest'
import { inboxRecipients, type InboxMember } from '../../utils/inboxRecipients'

// server/utils/pushNotifications.ts asks this who hears about a new message.
const owner: InboxMember = { id: 'tm-owner', user_id: 'u-owner', is_owner: true, inbox_access: false }
const desk: InboxMember = { id: 'tm-desk', user_id: 'u-desk', is_owner: false, inbox_access: true }
const doctor: InboxMember = { id: 'tm-doc', user_id: 'u-doc', is_owner: false, inbox_access: false }
const invited: InboxMember = { id: 'tm-new', user_id: null, is_owner: false, inbox_access: true }

describe('Who is told about a new Inbox message', () => {
  it('tells everyone who can see the Inbox when nobody has the conversation', () => {
    expect(inboxRecipients([owner, desk, doctor, invited], null)).toEqual(['u-owner', 'u-desk'])
  })
  it('tells only the person it is assigned to', () => {
    expect(inboxRecipients([owner, desk, doctor], 'tm-desk')).toEqual(['u-desk'])
  })
  it('falls back to everyone when the owner could not see it anyway', () => {
    expect(inboxRecipients([owner, desk, doctor], 'tm-doc')).toEqual(['u-owner', 'u-desk'])
    expect(inboxRecipients([owner, desk, invited], 'tm-new')).toEqual(['u-owner', 'u-desk'])
  })
})
