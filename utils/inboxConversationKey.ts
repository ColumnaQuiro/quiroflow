/**
 * The Inbox conversation a WhatsApp/Instagram message belongs to -- the key
 * the per-person reads, archives, labels and assignments are stored under.
 *
 * A message from somebody who is a lead and not a patient (lead_id set,
 * patient_id null) depends on the account:
 *
 * - With Growth, a lead is its own thread, keyed `lead:<id>`. That is how the
 *   web Inbox draws it (from /api/growth/conversations), how inbox_reads and
 *   inbox_assignments store it, and what a push notification names.
 * - Without Growth there is no lead thread, and the message is a conversation
 *   with its number (or Instagram account), the way inbox_conversations keys
 *   it (20260930142159_inbox_lead_messages_without_growth.sql).
 *
 * Everything else: the patient, else the number, else the Instagram id.
 *
 * Shared so the native app's Inbox (mobile/components/PractitionerInbox.vue),
 * which builds its threads itself, keys them the same way the web does.
 */
export interface KeyedInboxMessage {
  patient_id: string | null
  phone_number: string | null
  external_contact_id: string | null
  lead_id?: string | null
}

export function inboxConversationKey(m: KeyedInboxMessage, leadThreadsAreSeparate: boolean): string {
  if (leadThreadsAreSeparate && m.lead_id && !m.patient_id) return `lead:${m.lead_id}`
  return m.patient_id ?? m.phone_number ?? m.external_contact_id ?? 'unknown'
}

/** The lead a `lead:<id>` key names, or null for any other key. */
export function leadIdOfKey(key: string): string | null {
  return key.startsWith('lead:') ? key.slice('lead:'.length) || null : null
}
