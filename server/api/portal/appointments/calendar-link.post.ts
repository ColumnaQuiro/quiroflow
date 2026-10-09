import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// "Añadir al calendario": one of the patient's own visits as an .ics file,
// handed back as a short-lived link.
//
// A link rather than the bytes for the same reason as an invoice PDF
// (patient-invoices/pdf-link.post.ts): the app is a WKWebView, where a
// download or a blob URL goes nowhere, and a real URL opened in the system
// browser is what makes iOS offer "Añadir al calendario" (and Android open
// the calendar). Same authorization shape too: the read below runs as the
// patient, so appointments' RLS decides whether the visit exists at all;
// only then does the service role look up the clinic's name and address,
// which a patient cannot read.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ appointmentId?: string }>(event)
  if (!body?.appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, account_id, patient_id, clinic_id, starts_at, ends_at, status, deleted_at, appointment_types(name)')
    .eq('id', body.appointmentId)
    .maybeSingle()
  if (!appt || appt.deleted_at || appt.status === 'cancelled') {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: clinic } = await service.from('clinics').select('name, address').eq('id', appt.clinic_id).maybeSingle()
  const typeName = (appt.appointment_types as { name: string } | null)?.name ?? 'Cita'

  const ics = appointmentIcs({
    id: appt.id,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    title: clinic?.name ? `${typeName} · ${clinic.name}` : typeName,
    location: clinic?.address ?? null,
  })

  // One object per visit, overwritten: a visit moved since must not keep
  // handing out its old time.
  const path = `${appt.account_id}/${appt.patient_id}/${appt.id}.ics`
  const { error: uploadError } = await service.storage
    .from('calendar-files')
    .upload(path, Buffer.from(ics, 'utf8'), { contentType: 'text/calendar; charset=utf-8', upsert: true })
  if (uploadError) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the calendar file' })

  const { data: signed, error } = await service.storage.from('calendar-files').createSignedUrl(path, 60 * 5)
  if (error || !signed) throw createError({ statusCode: 502, statusMessage: 'Could not prepare the calendar file' })
  return { url: signed.signedUrl }
})
