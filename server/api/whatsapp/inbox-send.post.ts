import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { toE164, toE164Loose, whatsappDigits } from '~/utils/phone'
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { isWithin24hWindow, sendWhatsAppText, sendWhatsAppMedia, uploadMediaToMeta, type MediaKind } from '~/server/utils/whatsappSend'
import { findLeadIdByPhone, findPatientIdsByPhone } from '~/server/utils/whatsappOwner'

// The Inbox composer's send: free-form text or media, only ever within
// WhatsApp's 24h customer-service window (business-initiated messages
// outside that window still have to go through /api/whatsapp/send with a
// pre-approved template -- see that file's comment for why).
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    patientId?: string
    phoneNumber?: string
    /** Stamps the message onto a lead's thread as well as the phone's. */
    leadId?: string
    text?: string
    mediaBase64?: string
    mediaMimeType?: string
    mediaFilename?: string
    mediaKind?: MediaKind
    caption?: string
  }>(event)

  if (!body?.patientId && !body?.phoneNumber && !body?.leadId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId, leadId or phoneNumber is required' })
  }
  if (!body.text && !body.mediaBase64) {
    throw createError({ statusCode: 400, statusMessage: 'text or media is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, body?.leadId ? 'communication_config' : 'inbox_access')

  const { data: account } = await supabase
    .from('accounts')
    .select('id, whatsapp_phone_number_id, whatsapp_access_token, default_phone_country')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  await withMessagingTokens(teamMember.account_id, account)
  if (!account?.whatsapp_phone_number_id || !account?.whatsapp_access_token) {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp is not configured. Set it up in Settings > WhatsApp.' })
  }
  const waAccount = { whatsapp_phone_number_id: account.whatsapp_phone_number_id, whatsapp_access_token: account.whatsapp_access_token }

  let to = body.phoneNumber ?? ''

  // A lead reply resolves its number here rather than in a route of its own,
  // so it inherits everything below: the WhatsApp configuration check, the
  // 24h customer-service window, Meta's error surfacing, and the message row
  // the Inbox reads. A parallel lead-reply endpoint would have had to
  // reimplement all four, and would have drifted from them the first time
  // one changed.
  if (body.leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', body.leadId)
      .eq('account_id', teamMember.account_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })
    if (!lead.phone) throw createError({ statusCode: 400, statusMessage: 'This lead has no phone number to reply to' })
    // Loose, not toE164 -- and this is the second time the difference has
    // cost a working feature. A lead's phone is stored the way it arrived:
    // Meta's lead ads and WhatsApp's own webhook both strip the "+", so it
    // sits as "34617948363". toE164 sees no "+" and no "00", treats it as a
    // local number, and prepends Spain's dial code again -- "3434617948363",
    // which is not anybody, so every reply to every lead was refused by
    // Meta. toE164Loose recognises a number that already starts with the
    // country's dial code and leaves it alone.
    //
    // But that recognition only works for the account's OWN dial code, and a
    // lead's phone can belong to any country -- whatsappLeads.ts stores it as
    // already-international digits with no ambiguity to resolve, which is
    // exactly what prepending "+" back on before calling toE164Loose tells
    // it. Passed bare, a non-Spanish number ("5491131571300", Argentina)
    // doesn't start with the account's dial code either, so it fell through
    // to toE164 and got "34" prepended anyway -- "345491131571300", which
    // matched no row in whatsapp_messages, so the 24h window check found no
    // last-inbound message and refused every reply to a foreign lead as
    // "more than 24h" regardless of how recently they had written in.
    const e164 = toE164Loose(`+${lead.phone}`, account.default_phone_country ?? 'ES')
    if (!e164) throw createError({ statusCode: 400, statusMessage: "This lead's phone number could not be formatted for WhatsApp" })
    to = e164
  }

  if (body.patientId) {
    const { data: patient } = await supabase.from('patients').select('id, is_minor, do_not_contact').eq('id', body.patientId).maybeSingle()
    if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    if (patient.is_minor || patient.do_not_contact) {
      throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
    }
    // A reply goes back to the number they wrote from. It used to go to
    // "the WhatsApp number, else the first one", read in no particular order
    // -- so a patient with a work and a personal phone, writing from the
    // second, was answered on the first. And the 24h check below looked at
    // that first number, where they had not written, so the reply was
    // refused as outside the window while their message sat unanswered.
    // WhatsApp's window belongs to the number, so the number they last wrote
    // from is the only one a free-form reply can go to anyway.
    const { data: lastFromThem } = await supabase
      .from('whatsapp_messages')
      .select('phone_number')
      .eq('account_id', account.id)
      .eq('patient_id', body.patientId)
      .eq('direction', 'inbound')
      .eq('channel', 'whatsapp')
      .not('phone_number', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastFromThem?.phone_number) {
      to = whatsappDigits(lastFromThem.phone_number)
    } else {
      // They have never written: the window check below refuses this anyway,
      // and the number is only named in its message. Oldest first, so the
      // choice is at least the same one every time.
      const { data: numbers } = await supabase
        .from('patient_contact_numbers')
        .select('number, country_code, is_whatsapp')
        .eq('patient_id', body.patientId)
        .order('created_at')
      const target = numbers?.find((n) => n.is_whatsapp) ?? numbers?.[0]
      if (!target) throw createError({ statusCode: 400, statusMessage: 'This patient has no phone number on file' })
      const e164 = toE164(target.number, target.country_code)
      if (!e164) throw createError({ statusCode: 400, statusMessage: "This patient's phone number could not be formatted for WhatsApp" })
      to = e164
    }
  }

  const { data: lastInbound } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('account_id', account.id)
    .eq('phone_number', to)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!isWithin24hWindow(lastInbound?.created_at ?? null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'More than 24h since this patient last messaged you -- send a template instead (WhatsApp blocks free-form replies outside that window).',
    })
  }

  // A reply addressed by number alone -- the Inbox's thread for somebody who
  // is not a patient, on web and in the app -- still belongs to their lead.
  // The lead's own thread reads strictly by lead_id, and inbound messages
  // from this number are stamped with it by the webhook, so without this the
  // lead's page showed every question they asked and none of the answers
  // sent from the Inbox. Same rule as inbound: a patient owning the number
  // wins, and then the message belongs to nobody's lead.
  //
  // Looked up with the service role, as the webhook does, and scoped by
  // account inside both helpers: Inbox access does not imply Growth access,
  // and under the sender's own RLS a role that cannot list leads would find
  // none and quietly leave the reply off the lead again.
  let leadId = body.leadId ?? null
  if (!leadId && !body.patientId) {
    const admin = serverSupabaseServiceRole<Database>(event)
    if ((await findPatientIdsByPhone(admin, account.id, to)).length === 0) {
      leadId = await findLeadIdByPhone(admin, account.id, to)
    }
  }

  const insert: Record<string, unknown> = {
    account_id: account.id,
    patient_id: body.patientId ?? null,
    lead_id: leadId,
    phone_number: to,
    direction: 'outbound',
    status: 'sent',
    purpose: 'other',
  }

  // The row is stored the moment Meta answers with its wamid, and the copy
  // of a file for the thread is uploaded only after that. The other way
  // round, a status callback could arrive while up to 16 MB was still
  // uploading, find no row, and be lost -- a message refused within seconds
  // then showed as sent for good. (A callback that still beats the insert is
  // held for it in the database: see record_whatsapp_status.)
  let upload: { path: string; buffer: Buffer; contentType: string } | null = null
  try {
    if (body.mediaBase64 && body.mediaMimeType && body.mediaKind) {
      const buffer = Buffer.from(body.mediaBase64, 'base64')
      const filename = body.mediaFilename ?? 'file'
      const mediaId = await uploadMediaToMeta(waAccount, buffer, body.mediaMimeType, filename)
      insert.wamid = await sendWhatsAppMedia(waAccount, to, body.mediaKind, mediaId, { caption: body.caption, filename })

      const path = `${account.id}/out-${Date.now()}-${sanitizeStorageFilename(filename)}`
      upload = { path, buffer, contentType: body.mediaMimeType }
      insert.media_type = body.mediaKind
      insert.media_storage_path = path
      insert.media_mime_type = body.mediaMimeType
      insert.media_filename = body.mediaFilename ?? null
      insert.body_preview = body.caption?.slice(0, 2000) ?? null
    } else if (body.text) {
      insert.wamid = await sendWhatsAppText(waAccount, to, body.text)
      insert.body_preview = body.text.slice(0, 2000)
    }
  } catch (err: any) {
    // error_data.details carries the actual reason behind a generic title
    // like "Media upload error" (e.g. an unsupported mime type) -- surfacing
    // it is the difference between a diagnosable failure and a guess.
    const metaError = err?.data?.error
    const metaMessage = metaError ? [metaError.message, metaError.error_data?.details].filter(Boolean).join(' -- ') : null
    throw createError({ statusCode: 502, statusMessage: metaMessage ?? 'WhatsApp send failed' })
  }

  await supabase.from('whatsapp_messages').insert(insert as never)
  if (upload) {
    await supabase.storage.from('whatsapp-media').upload(upload.path, upload.buffer, { contentType: upload.contentType, upsert: true })
  }

  return { success: true }
})
