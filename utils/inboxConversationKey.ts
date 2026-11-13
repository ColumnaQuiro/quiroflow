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

/**
 * A message as its realtime UPDATE says it is filed now. The fields that pick
 * its conversation are taken from `next` when the payload carries them, so a
 * lead's message the conversion has just given a patient re-keys into the
 * patient's thread instead of staying cached under `lead:<id>`.
 */
export function withConversationOf<M extends KeyedInboxMessage>(current: M, next: Partial<KeyedInboxMessage>): M {
  return {
    ...current,
    patient_id: 'patient_id' in next ? (next.patient_id ?? null) : current.patient_id,
    phone_number: 'phone_number' in next ? (next.phone_number ?? null) : current.phone_number,
    external_contact_id: 'external_contact_id' in next ? (next.external_contact_id ?? null) : current.external_contact_id,
    lead_id: 'lead_id' in next ? (next.lead_id ?? null) : current.lead_id,
  }
}

/**
 * Leads something is still held for (a cached message, a row in the list)
 * that the Growth list no longer names: converted, or deleted, since it was
 * loaded. Only these are worth asking the database about.
 */
export function leadsMissingFromList(held: Iterable<string | null | undefined>, listed: Iterable<string>): string[] {
  const named = new Set(listed)
  const missing = new Set<string>()
  for (const id of held) if (id && !named.has(id)) missing.add(id)
  return [...missing]
}

/**
 * The cached messages as a conversion left them in the database: each
 * converted lead's messages that had no patient take the lead's patient, as
 * fold_lead_thread_into_patient (20261012055054) does. The same array when
 * nothing changed, so a caller can skip the reassignment.
 */
export function foldConvertedLeadMessages<M extends KeyedInboxMessage>(messages: M[], patientByLead: Record<string, string>): M[] {
  let changed = false
  const folded = messages.map((m) => {
    const patientId = m.lead_id && !m.patient_id ? patientByLead[m.lead_id] : undefined
    if (!patientId) return m
    changed = true
    return { ...m, patient_id: patientId }
  })
  return changed ? folded : messages
}
