import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'
import { toE164 } from '~/utils/phone'
import { downloadMetaMedia, extensionForMimeType, type MediaKind } from '~/server/utils/whatsappSend'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'

// Meta's ongoing webhook: delivers both outbound message status updates
// (sent/delivered/read/failed) and inbound replies from patients, in the
// same payload shape, one account's callbacks at a time identified by
// phone_number_id. There's no Supabase session here -- Meta calls this
// directly -- so it authenticates as service role and resolves the account
// itself rather than relying on a signed-in team member.

interface MetaStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errors?: { code: number; title: string; error_data?: { details?: string } }[]
}
interface MetaMedia {
  id: string
  mime_type: string
  caption?: string
  filename?: string
}
interface MetaMessage {
  id: string
  from: string
  type: string
  text?: { body: string }
  button?: { text: string }
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }
  image?: MetaMedia
  video?: MetaMedia
  audio?: MetaMedia
  document?: MetaMedia
  sticker?: MetaMedia
}
interface MetaChangeValue {
  metadata?: { phone_number_id: string }
  statuses?: MetaStatus[]
  messages?: MetaMessage[]
}

const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio', 'document', 'sticker']

const CONFIRM_WORDS = ['confirmo', 'confirmar', 'confirmado', 'sí', 'si', 'yes', 'confirm', 'vale', 'ok', 'okay']
const RESCHEDULE_WORDS = ['cambiar', 'cambio', 'reprogramar', 'reschedule', 'aplazar', 'posponer', 'mover']
const CANCEL_WORDS = ['cancelar', 'cancelo', 'cancelado', 'anular', 'cancel']

function replyText(msg: MetaMessage): string {
  return msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? msg.text?.body ?? ''
}

function classifyReply(text: string): 'confirmed' | 'reschedule_requested' | 'cancelled' | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (CANCEL_WORDS.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!'))) return 'cancelled'
  if (CONFIRM_WORDS.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!'))) return 'confirmed'
  if (RESCHEDULE_WORDS.some((w) => t.includes(w))) return 'reschedule_requested'
  return null
}

// Returns every patient whose contact number resolves to this phone --
// plural, not singular: staff testing (or a family sharing one phone
// across a few real patients) can leave more than one patient record
// pointing at the same number. Most callers below just need any one of
// them (a message can only be attributed to a single patient_id), but the
// confirm/reschedule/cancel handler needs all of them: it resolves which
// specific appointment a reply is about across every patient sharing the
// number (see resolveRepliedAppointment), rather than betting on an
// arbitrary first match that may have nothing scheduled.
async function findPatientIdsByPhone(supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>, accountId: string, fromNumber: string): Promise<string[]> {
  const PAGE_SIZE = 1000
  const matches: string[] = []
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('patient_contact_numbers')
      .select('patient_id, number, country_code')
      .eq('account_id', accountId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const c of data ?? []) {
      if (toE164(c.number, c.country_code) === fromNumber) matches.push(c.patient_id)
    }
    if (!data || data.length < PAGE_SIZE) return matches
  }
}

// Which appointment is a Confirmar/Cambiar/Cancelar reply about?
//
// This used to be a single query for "the earliest-starting appointment with
// confirmation_status = 'pending'", which had two problems. It silently
// no-opped whenever nothing had set that flag yet -- an automation-rule
// reminder sent days before the built-in one, for instance -- throwing away
// a real confirmation the patient had just sent. And ordering every
// appointment ever by starts_at ascending, with no lower bound and no
// deleted/cancelled filter, meant one stale 'pending' row from months back
// would soak up replies meant for next week's visit.
//
// So: anchor on the appointment the most recent outbound message to this
// patient actually referenced, since that's literally what they're replying
// to, and only fall back to scanning upcoming appointments if that message
// carried no appointment (a free-text inbox reply, say).
async function resolveRepliedAppointment(
  supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>,
  patientIds: string[],
): Promise<{ id: string; patient_id: string } | null> {
  const { data: lastOutbound } = await supabase
    .from('whatsapp_messages')
    .select('appointment_id')
    .in('patient_id', patientIds)
    .eq('direction', 'outbound')
    .not('appointment_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastOutbound?.appointment_id) {
    const { data: anchored } = await supabase
      .from('appointments')
      .select('id, patient_id, status')
      .eq('id', lastOutbound.appointment_id)
      .is('deleted_at', null)
      .maybeSingle()
    // Only honour the anchor while the appointment is still live -- a reply
    // to a reminder for something since cancelled shouldn't resurrect it.
    if (anchored && anchored.status === 'booked') return { id: anchored.id, patient_id: anchored.patient_id }
  }

  // Fallback: the soonest appointment still ahead of them. A small grace
  // window back from now keeps a reply sent just after the start time (or
  // while the webhook was retrying) attached to that same visit.
  const graceCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: upcoming } = await supabase
    .from('appointments')
    .select('id, patient_id')
    .in('patient_id', patientIds)
    .eq('status', 'booked')
    .is('deleted_at', null)
    .gte('starts_at', graceCutoff)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return upcoming ?? null
}

export default defineEventHandler(async (event) => {
  const supabase = serverSupabaseServiceRole<Database>(event)
  const body = await readBody<{ entry?: { changes?: { value?: MetaChangeValue }[] }[] }>(event)

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      const { data: account } = await supabase
        .from('accounts')
        .select('id, whatsapp_phone_number_id, whatsapp_access_token')
        .eq('whatsapp_phone_number_id', phoneNumberId)
        .maybeSingle()
      if (!account) continue

      for (const status of value?.statuses ?? []) {
        // error_data.details carries the actual reason behind a generic
        // title like "Media upload error" (e.g. which mime type/constraint
        // was violated) -- appending it is the difference between a
        // diagnosable failure and a guess next time one happens.
        const error = status.errors?.[0]
        const errorMessage = error ? [error.title, error.error_data?.details].filter(Boolean).join(' -- ') : null
        await supabase
          .from('whatsapp_messages')
          .update({
            status: status.status,
            error_code: error?.code != null ? String(error.code) : null,
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('wamid', status.id)
      }

      for (const msg of value?.messages ?? []) {
        const patientIds = await findPatientIdsByPhone(supabase, account.id, msg.from)
        const patientId = patientIds[0] ?? null
        const mediaKind = MEDIA_KINDS.includes(msg.type as MediaKind) ? (msg.type as MediaKind) : null
        const media = mediaKind ? msg[mediaKind] : undefined

        const insert: Database['public']['Tables']['whatsapp_messages']['Insert'] = {
          account_id: account.id,
          patient_id: patientId,
          phone_number: msg.from,
          wamid: msg.id,
          direction: 'inbound',
          status: 'received',
          body_preview: null,
        }

        if (mediaKind && media && account.whatsapp_access_token) {
          try {
            const { buffer, mimeType } = await downloadMetaMedia(
              { whatsapp_phone_number_id: account.whatsapp_phone_number_id!, whatsapp_access_token: account.whatsapp_access_token },
              media.id,
            )
            const ext = extensionForMimeType(mimeType)
            const path = `${account.id}/${msg.id}.${ext}`
            await supabase.storage.from('whatsapp-media').upload(path, buffer, { contentType: mimeType, upsert: true })
            insert.media_type = mediaKind
            insert.media_storage_path = path
            insert.media_mime_type = mimeType
            insert.media_filename = media.filename ?? null
            insert.body_preview = media.caption?.slice(0, 200) ?? null
          } catch {
            // Best-effort -- still record that a media message arrived even
            // if the download failed, rather than dropping it silently.
            insert.media_type = mediaKind
            insert.body_preview = media.caption?.slice(0, 200) ?? '(media download failed)'
          }
        } else {
          const text = replyText(msg)
          insert.body_preview = text.slice(0, 2000) || null
        }

        await supabase.from('whatsapp_messages').insert(insert)

        let senderName = msg.from
        if (patientId) {
          const { data: patient } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
          if (patient) senderName = `${patient.first_name} ${patient.last_name ?? ''}`.trim()
        }
        await notifyInboxTeamMembers(event, supabase, account.id, senderName, insert.body_preview ?? 'New message', {
          type: 'whatsapp_message',
          key: patientId ?? msg.from,
        })

        const intent = classifyReply(replyText(msg))
        if (intent && patientIds.length > 0) {
          const appt = await resolveRepliedAppointment(supabase, patientIds)
          if (appt) {
            if (intent === 'cancelled') {
              // 'cancelled' isn't a confirmation_status value (that column
              // only tracks pending/confirmed/reschedule_requested) -- a
              // cancellation reply cancels the appointment itself, same
              // field the in-app cancel flow uses, minus any cancellation
              // fee (that's a staff judgment call made from a confirm()
              // dialog elsewhere, not something to apply automatically off
              // an inbound message).
              await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id)
              // No staff session on a Meta webhook call, so this can't go
              // through fire.post.ts (requireTeamMember-gated) -- same
              // direct-call pattern as birthday-cron.post.ts.
              const { data: patient } = await supabase
                .from('patients')
                .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels')
                .eq('id', appt.patient_id)
                .maybeSingle()
              if (patient) {
                const { data: rules } = await supabase
                  .from('automation_rules')
                  .select('id, filters')
                  .eq('account_id', account.id)
                  .eq('trigger_event', 'appointment.cancelled')
                  .eq('enabled', true)
                const origin = getRequestURL(event).origin
                for (const rule of rules ?? []) {
                  if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, appt.id))) continue
                  await runRuleActions(supabase, account.id, rule.id, patient, origin, appt.id, {
                    triggerEvent: 'appointment.cancelled',
                    patientId: patient.id,
                    appointmentId: appt.id,
                  })
                }
              }
            } else {
              await supabase.from('appointments').update({ confirmation_status: intent }).eq('id', appt.id)
            }
          }
        }
      }
    }
  }

  return { success: true }
})
