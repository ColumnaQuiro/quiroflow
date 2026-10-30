import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { signCheckInCode } from '~/server/utils/checkInCode'
import { checkInCodeKey } from '~/server/utils/checkInPortal'

// The QR code for the front-desk check-in portal, from the app and the web
// portal (components/patient/CheckInCode.vue): ?appointmentId= names the
// visit it is shown for, read as the patient so it is one they can see --
// their own or a family member's they manage -- and the code is for that
// visit's patient (server/utils/checkInCode.ts). Drawn here as SVG, so
// neither the app nor the portal needs a QR library of its own.
//
// { code: null, svg: null } when the visit's location has no check-in portal
// turned on: there is no tablet to show it to, and the app shows nothing.
export default defineEventHandler(async (event) => {
  const appointmentId = getQuery(event).appointmentId
  if (typeof appointmentId !== 'string' || !appointmentId) throw createError({ statusCode: 400, statusMessage: 'appointmentId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: appt } = await supabase.from('appointments').select('patient_id, clinic_id').eq('id', appointmentId).maybeSingle()
  if (!appt?.patient_id) throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })

  // check_in_portals is read on the service role only; this says no more
  // than whether the patient's own visit's location has a tablet.
  const { data: portal } = await serverSupabaseServiceRole<Database>(event).from('check_in_portals').select('clinic_id').eq('clinic_id', appt.clinic_id).maybeSingle()
  const key = checkInCodeKey()
  if (!portal || !key) return { code: null, svg: null }

  const code = signCheckInCode(key, appt.patient_id)
  const { default: QRCode } = await import('qrcode')
  const svg = await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { code, svg }
})
