import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'
import { phoneMatches } from '~/utils/phone'
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
import type { InstagramMessagingEvent } from '~/server/utils/instagramWebhook'
import { leadForWhatsAppSender } from '~/server/utils/whatsappLeads'

interface MetaChangeValue {
  metadata?: { phone_number_id: string }
  statuses?: MetaStatus[]
  messages?: MetaMessage[]
  // Sent alongside an inbound message, and the only name we will ever get for
  // a stranger -- there is no profile endpoint to ask afterwards the way
  // Instagram has one.
  contacts?: { wa_id: string; profile?: { name?: string } }[]
}

const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio', 'document', 'sticker']

const CONFIRM_WORDS = ['confirmo', 'confirmar', 'confirmado', 'sí', 'si', 'yes', 'confirm', 'vale', 'ok', 'okay']
const RESCHEDULE_WORDS = ['cambiar', 'cambio', 'reprogramar', 'reschedule', 'aplazar', 'posponer', 'mover']
const CANCEL_WORDS = ['cancelar', 'cancelo', 'cancelado', 'anular', 'cancel']

function replyText(msg: MetaMessage): string {
  return msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? msg.text?.body ?? ''
}

// Things a patient asks to change that are NOT their appointment. "Me
// gustaría cambiar el Mail que tenéis registrado con mi ficha" is the
// message that started this: it matched on "cambiar" alone and recorded a
// patient who had tapped Confirmar fourteen minutes earlier as wanting to
// move his visit.
//
// Excluding by the OBJECT of the verb rather than by where the verb sits in
// the sentence, because position turns out not to separate the two cases at
// all -- "La tengo que cambiar", "Me la puedes cambiar por la tarde", "Queria
// reprogramarla a la semana que viene" are all real requests that name the
// appointment only as "la", leaning on the reminder they are replying to.
// Anchoring the match to the start of the message would have thrown those
// away to catch this one.
const CHANGE_OF_SOMETHING_ELSE =
  /(cambiar|cambio|cambiarme|modificar)\s+(el\s+|la\s+|mi\s+|mis\s+)?(mail|email|correo|tel[eé]fono|movil|m[oó]vil|n[uú]mero|direcci[oó]n|nombre|apellido|dni|datos|ficha|contrase[nñ]a)/

function classifyReply(text: string): 'confirmed' | 'reschedule_requested' | 'cancelled' | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const opensWith = (words: string[]) => words.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!'))
  if (opensWith(CANCEL_WORDS)) return 'cancelled'
  if (opensWith(CONFIRM_WORDS)) return 'confirmed'
  if (RESCHEDULE_WORDS.some((w) => t.includes(w)) && !CHANGE_OF_SOMETHING_ELSE.test(t)) return 'reschedule_requested'
  return null
}

// Did the patient ANSWER the question, or just write a sentence we read an
// intent out of? A tap on the reminder's own buttons is the answer itself --
// Meta sends it back as a button/list reply carrying that button's title.
// Free text is an inference, and a weaker claim: it settles a question still
// open, but it does not overturn an answer the patient already gave (see the
// update below). That is what saves the two people who tried to TAKE BACK an
// accidental tap: "Perdon!! Le di a cambiar cita sin querer" and "Me he
// confundido al cambiar" both re-flagged the very thing they apologised for,
// leaving no wording that could undo it.
function isButtonReply(msg: MetaMessage): boolean {
  return Boolean(msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title)
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
      if (phoneMatches(c.number, c.country_code, fromNumber)) matches.push(c.patient_id)
    }
    if (!data || data.length < PAGE_SIZE) return matches
  }
}

/**
 * The lead this number belongs to, when it belongs to no patient.
 *
 * Inbound messages were attributed to a patient or to nobody, which meant a
 * reply from somebody who enquired through a Facebook ad -- a lead, by
 * definition not yet a patient -- attached to nothing. Their thread in the
 * Inbox showed only what the clinic had sent them, with their answers
 * missing, and the lead's own drawer showed no sign they had ever written
 * back.
 *
 * Patients win where a number matches both, deliberately: somebody who has
 * become a patient is a patient, and their clinical thread is the one their
 * messages belong in. This only runs when no patient matched at all.
 *
 * Newest lead wins where one person enquired twice, on the grounds that the
 * reply is far more likely to be about the enquiry they just made.
 */
async function findLeadIdByPhone(supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>, accountId: string, fromNumber: string): Promise<string | null> {
  const { data } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .not('phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const incoming = fromNumber.replace(/\D/g, '')
  for (const lead of data ?? []) {
    // The same tolerance patients get: a lead's number may have been typed
    // by hand at the desk, or arrived from Meta with no "+", and both should
    // still match the digits Meta sends on the way back.
    if (lead.phone && phoneMatches(lead.phone, 'ES', incoming)) return lead.id
  }
  return null
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
): Promise<{ id: string; patient_id: string; confirmation_status: string | null } | null> {
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
      .select('id, patient_id, status, confirmation_status')
      .eq('id', lastOutbound.appointment_id)
      .is('deleted_at', null)
      .maybeSingle()
    // Only honour the anchor while the appointment is still live -- a reply
    // to a reminder for something since cancelled shouldn't resurrect it.
    if (anchored && anchored.status === 'booked') {
      return { id: anchored.id, patient_id: anchored.patient_id, confirmation_status: anchored.confirmation_status }
    }
  }

  // Fallback: the soonest appointment still ahead of them. A small grace
  // window back from now keeps a reply sent just after the start time (or
  // while the webhook was retrying) attached to that same visit.
  const graceCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: upcoming } = await supabase
    .from('appointments')
    .select('id, patient_id, confirmation_status')
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

  // Raw bytes, not readBody(): Meta's signature is an HMAC over exactly what
  // was sent, so parsing and re-encoding first would invalidate it. Everything
  // below works from this same Buffer.
  const rawBody = await readRawBody(event, false)
  if (!rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Empty request body.' })
  }

  // Who is this? Established before a byte of the payload is believed. Until
  // this change there was no answer -- anyone who knew a clinic's
  // whatsapp_phone_number_id could cancel a patient's appointment here.
  const auth = await resolveWebhookAuth(event)
  if (!auth) {
    throw createError({
      statusCode: 401,
      statusMessage:
        'Unauthenticated. Either let Meta post directly (it signs with X-Hub-Signature-256, and Settings > WhatsApp needs your Meta App Secret), or have your forwarder send an API token with the whatsapp:webhook scope.',
    })
  }

  // Counted so the response can say "I did not take this", rather than
  // answering 200 and dropping it. See the throw at the end of the handler.
  let unverified = 0

  let body: {
    object?: string
    entry?: {
      id?: string
      changes?: { value?: MetaChangeValue }[]
      /** Instagram's shape: messages hang off the entry, not off a change. */
      messaging?: InstagramMessagingEvent[]
    }[]
  }
  try {
    body = JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Body is not valid JSON.' })
  }

  // Instagram arrives on this same endpoint, signed by the same app with the
  // same secret -- one Meta app, two products -- but in a different shape:
  // entry[].messaging[] rather than entry[].changes[], an IGSID instead of a
  // phone number, and no statuses. Handled in its own pass rather than
  // threaded through the loop below, which is built around
  // value.metadata.phone_number_id and would need an `if` on every line.
  if (body.object === 'instagram') {
    const handled = await handleInstagramEntries(supabase, body.entry ?? [], auth, rawBody)
    if (handled.unverified > 0) {
      throw createError({
        statusCode: 401,
        statusMessage: `Could not verify ${handled.unverified} Instagram event(s).`,
      })
    }
    return { success: true }
  }

  // Which phone number ids this delivery has already complained about. A
  // single POST can carry several changes for one number, and one unroutable
  // number should read as one problem rather than as a burst.
  const alreadyReported = new Set<string>()

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Deliberately not .maybeSingle(). That returns NULL for two matching
      // rows just as it does for none, so two accounts sharing a phone number
      // id used to land in the same `if (!account) continue` as an unknown
      // number -- inbound WhatsApp stopping dead for BOTH clinics with nothing
      // logged, no failed request, and each one's Settings > WhatsApp page
      // still showing a correct configuration. There was no symptom to notice.
      //
      // accounts_whatsapp_phone_number_id_key now makes two rows impossible,
      // so the branch below should never be taken. It stays because "cannot
      // happen" is exactly what was believed before, and the cost of being
      // wrong a second time is silence again: an index can be dropped, a
      // restore can omit it, and neither announces itself. Two rows is a
      // routing question this code cannot answer, so it refuses to guess.
      const { data: matches, error: lookupError } = await supabase
        .from('accounts')
        .select('id, whatsapp_phone_number_id, whatsapp_access_token')
        .eq('whatsapp_phone_number_id', phoneNumberId)
        .limit(2)

      if (lookupError) {
        console.error(`[whatsapp] could not look up the account for phone number id ${phoneNumberId}: ${lookupError.message}`)
        continue
      }
      if (matches.length > 1) {
        if (!alreadyReported.has(phoneNumberId)) {
          alreadyReported.add(phoneNumberId)
          console.error(
            `[whatsapp] phone number id ${phoneNumberId} is claimed by ${matches.length} accounts (${matches.map((a) => a.id).join(', ')}). ` +
              'Dropping this delivery: there is no way to tell which clinic it belongs to. Inbound WhatsApp is DOWN for every account sharing it ' +
              'until one of them is cleared -- accounts_whatsapp_phone_number_id_key should have prevented this, so check it still exists.',
          )
        }
        continue
      }
      const account = matches[0]
      if (!account) {
        // Meta only delivers for WABAs this app is subscribed to, so a number
        // we cannot place is a real misconfiguration -- a clinic that changed
        // its number in Settings, or a subscription outliving the connection
        // that created it -- and the messages are being lost meanwhile.
        if (!alreadyReported.has(phoneNumberId)) {
          alreadyReported.add(phoneNumberId)
          console.warn(
            `[whatsapp] no account has phone number id ${phoneNumberId}. Dropping this delivery -- ` +
              'the number in Settings > WhatsApp may not match the one Meta is sending from.',
          )
        }
        continue
      }

      // The authorisation decision, and on the signature path the verification
      // itself -- it needs the account to know which secret to check against.
      // Locating the account from the body is not trusting the body: nothing
      // below this line runs unless the proof holds for this specific clinic.
      if (!(await webhookMayActOnAccount(auth, account.id, rawBody, supabase))) {
        console.error(
          `[whatsapp] rejected an unverified webhook for account ${account.id} (${auth.kind} auth). ` +
            'On the signature path this usually means no Meta App Secret is stored in Settings > WhatsApp.',
        )
        unverified++
        continue
      }

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

      // Keyed by wa_id, because a batch can carry messages from more than one
      // sender and the names must not be crossed over.
      const profileNames = new Map((value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name?.trim() || null]))

      for (const msg of value?.messages ?? []) {
        const patientIds = await findPatientIdsByPhone(supabase, account.id, msg.from)
        const patientId = patientIds[0] ?? null
        // Three ways to belong to somebody, in descending confidence: a
        // patient, a lead already on the board, or nobody -- which used to
        // mean the message attached to nothing and the person who sent it
        // was never recorded as having asked. That last case now creates the
        // lead, the way an Instagram DM already does.
        const leadId = patientId
          ? null
          : ((await findLeadIdByPhone(supabase, account.id, msg.from))
            ?? (await leadForWhatsAppSender(supabase, account.id, msg.from, profileNames.get(msg.from) ?? null)))
        const mediaKind = MEDIA_KINDS.includes(msg.type as MediaKind) ? (msg.type as MediaKind) : null
        const media = mediaKind ? msg[mediaKind] : undefined

        const insert: Database['public']['Tables']['whatsapp_messages']['Insert'] = {
          account_id: account.id,
          patient_id: patientId,
          lead_id: leadId,
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

        // A lead writing back is the thing the whole acquisition funnel is
        // trying to cause, and until now it left no trace anywhere except an
        // unattributed row. Recorded on the lead's own timeline so the drawer
        // shows it, and flagged as needing a person: the AI receptionist does
        // not answer real enquiries yet, so nobody is replying unless a human
        // does.
        if (leadId) {
          await supabase.from('lead_events').insert({
            account_id: account.id,
            lead_id: leadId,
            kind: 'conversation',
            title: 'Replied',
            detail: insert.body_preview?.slice(0, 500) ?? null,
          })
          // Only lifts a lead the AI was handling, so a lead a person has
          // already taken over is left where that person put it.
          await supabase
            .from('leads')
            .update({ ai_state: 'needs_human' })
            .eq('id', leadId)
            .eq('ai_state', 'handling')
        }

        let senderName = msg.from
        if (patientId) {
          const { data: patient } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
          if (patient) senderName = `${patient.first_name} ${patient.last_name ?? ''}`.trim()
        } else if (leadId) {
          const { data: lead } = await supabase.from('leads').select('full_name').eq('id', leadId).maybeSingle()
          if (lead?.full_name) senderName = lead.full_name
        }
        await notifyInboxTeamMembers(supabase, account.id, senderName, insert.body_preview ?? 'New message', {
          type: 'whatsapp_message',
          key: patientId ?? leadId ?? msg.from,
        })

        const intent = classifyReply(replyText(msg))
        if (intent && patientIds.length > 0) {
          const appt = await resolveRepliedAppointment(supabase, patientIds)
          // An answer already on record is only overturned by another
          // deliberate tap, never by a later sentence we merely read an
          // intent out of. Patients carry on writing after they answer --
          // about their email address, to thank reception, to take back a
          // mis-tap -- and any of that outranking their own Confirmar is
          // how a confirmed appointment silently became "wants to
          // reschedule" on the calendar. Staff see every inbound message in
          // the inbox regardless, so nothing is lost by leaving the flag
          // alone and letting a person decide.
          const alreadyAnswered = appt?.confirmation_status === 'confirmed' || appt?.confirmation_status === 'reschedule_requested'
          if (appt && (!alreadyAnswered || isButtonReply(msg))) {
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

  // A message we could not verify must not be answered with 200.
  //
  // It used to be: the change was skipped, the handler returned success, and
  // Meta -- told the delivery worked -- never sent it again. The message was
  // gone, with nothing to see anywhere. No error, no row, no retry. The only
  // trace was a console line nobody reads until something is already missing.
  //
  // 401 instead, so Meta retries with backoff for up to 7 days. That turns
  // every transient cause -- an app secret not yet saved, a deploy mid-flight,
  // a clock skew -- from lost messages into late ones. Replays are safe:
  // whatsapp_messages.wamid is uniquely indexed, so a redelivery of something
  // already stored inserts nothing.
  //
  // The cost is an oracle: a forged request naming a phone_number_id we know
  // gets 401, an unknown one gets 200, so the difference reveals which
  // clinics are here. That is worth it. Nothing in the payload is acted on
  // without a valid signature either way, and silently losing a patient's
  // message is the worse failure -- which is not hypothetical, it is what
  // sent us looking.
  if (unverified > 0) {
    throw createError({
      statusCode: 401,
      statusMessage: `Could not verify ${unverified} change(s). Check the Meta App Secret in Settings > WhatsApp, or the forwarder's API token.`,
    })
  }

  return { success: true }
})
