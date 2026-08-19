import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { toE164 } from '~/utils/phone'

// Meta's ongoing webhook: delivers both outbound message status updates
// (sent/delivered/read/failed) and inbound replies from patients, in the
// same payload shape, one account's callbacks at a time identified by
// phone_number_id. There's no Supabase session here -- Meta calls this
// directly -- so it authenticates as service role and resolves the account
// itself rather than relying on a signed-in team member.

interface MetaStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errors?: { code: number; title: string }[]
}
interface MetaMessage {
  id: string
  from: string
  type: string
  text?: { body: string }
  button?: { text: string }
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }
}
interface MetaChangeValue {
  metadata?: { phone_number_id: string }
  statuses?: MetaStatus[]
  messages?: MetaMessage[]
}

const CONFIRM_WORDS = ['confirmo', 'confirmar', 'confirmado', 'sí', 'si', 'yes', 'confirm', 'vale', 'ok', 'okay']
const RESCHEDULE_WORDS = ['cambiar', 'cambio', 'reprogramar', 'reschedule', 'aplazar', 'posponer', 'mover']

function replyText(msg: MetaMessage): string {
  return msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? msg.text?.body ?? ''
}

function classifyReply(text: string): 'confirmed' | 'reschedule_requested' | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (CONFIRM_WORDS.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!'))) return 'confirmed'
  if (RESCHEDULE_WORDS.some((w) => t.includes(w))) return 'reschedule_requested'
  return null
}

async function findPatientByPhone(supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>, accountId: string, fromNumber: string) {
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('patient_contact_numbers')
      .select('patient_id, number, country_code')
      .eq('account_id', accountId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    const match = (data ?? []).find((c) => toE164(c.number, c.country_code) === fromNumber)
    if (match) return match.patient_id
    if (!data || data.length < PAGE_SIZE) return null
  }
}

export default defineEventHandler(async (event) => {
  const supabase = serverSupabaseServiceRole<Database>(event)
  const body = await readBody<{ entry?: { changes?: { value?: MetaChangeValue }[] }[] }>(event)

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      const { data: account } = await supabase.from('accounts').select('id').eq('whatsapp_phone_number_id', phoneNumberId).maybeSingle()
      if (!account) continue

      for (const status of value?.statuses ?? []) {
        await supabase
          .from('whatsapp_messages')
          .update({
            status: status.status,
            error_code: status.errors?.[0]?.code != null ? String(status.errors[0].code) : null,
            error_message: status.errors?.[0]?.title ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('wamid', status.id)
      }

      for (const msg of value?.messages ?? []) {
        const patientId = await findPatientByPhone(supabase, account.id, msg.from)
        const text = replyText(msg)

        await supabase.from('whatsapp_messages').insert({
          account_id: account.id,
          patient_id: patientId,
          wamid: msg.id,
          direction: 'inbound',
          status: 'received',
          body_preview: text.slice(0, 200) || null,
        })

        const intent = classifyReply(text)
        if (intent && patientId) {
          const { data: appt } = await supabase
            .from('appointments')
            .select('id')
            .eq('patient_id', patientId)
            .eq('confirmation_status', 'pending')
            .order('starts_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (appt) await supabase.from('appointments').update({ confirmation_status: intent }).eq('id', appt.id)
        }
      }
    }
  }

  return { success: true }
})
